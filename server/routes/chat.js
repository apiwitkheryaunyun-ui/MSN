const express = require('express');
const router = express.Router();
const db = require('../db/schema');
const auth = require('../middleware');

const MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024;
const MESSAGE_TYPES = new Set(['text', 'nudge', 'wink', 'file']);
const IS_GROUP_TRUE_SQL = db.isPG
  ? "COALESCE(c.is_group::text, '0') IN ('1','t','true')"
  : 'c.is_group = 1';
const IS_GROUP_FALSE_SQL = db.isPG
  ? "COALESCE(c.is_group::text, '0') IN ('0','f','false')"
  : 'c.is_group = 0';

async function getOrCreateConv(userId, friendId) {
  const existing = await db.get(`
    SELECT c.id
    FROM conversations c
    JOIN conversation_members m1 ON m1.conversation_id = c.id AND m1.user_id = ?
    JOIN conversation_members m2 ON m2.conversation_id = c.id AND m2.user_id = ?
    WHERE ${IS_GROUP_FALSE_SQL}
      AND (SELECT COUNT(*) FROM conversation_members WHERE conversation_id = c.id) = 2
    LIMIT 1
  `, [userId, friendId]);

  if (existing) {
    return existing.id;
  }

  const conv = await db.run('INSERT INTO conversations (title, owner_id, is_group) VALUES (?,?,0)', ['', userId]);
  await db.run(
    'INSERT INTO conversation_members (conversation_id, user_id) VALUES (?,?),(?,?)',
    [conv.lastID, userId, conv.lastID, friendId]
  );
  return conv.lastID;
}

async function requireAcceptedFriendship(userId, friendId) {
  return db.get(
    "SELECT id FROM friends WHERE status='accepted' AND ((user_id=? AND friend_id=?) OR (user_id=? AND friend_id=?))",
    [userId, friendId, friendId, userId]
  );
}

async function requireConversationMember(conversationId, userId) {
  return db.get(
    'SELECT 1 FROM conversation_members WHERE conversation_id = ? AND user_id = ?',
    [conversationId, userId]
  );
}

async function getGroup(conversationId) {
  return db.get(
    `SELECT c.id, c.title, c.owner_id,
            (SELECT COUNT(*) FROM conversation_members cm WHERE cm.conversation_id = c.id) AS member_count,
            (SELECT content FROM messages WHERE conversation_id = c.id ORDER BY sent_at DESC, id DESC LIMIT 1) AS last_msg,
            (SELECT sent_at FROM messages WHERE conversation_id = c.id ORDER BY sent_at DESC, id DESC LIMIT 1) AS last_time
     FROM conversations c
     WHERE c.id = ? AND ${IS_GROUP_TRUE_SQL}`,
    [conversationId]
  );
}

async function getGroupMembers(conversationId) {
  return db.all(
    `SELECT u.id, u.msn_id, u.username, u.display_name, u.status, u.status_msg, u.avatar_url
     FROM conversation_members cm
     JOIN users u ON u.id = cm.user_id
     WHERE cm.conversation_id = ?
     ORDER BY u.display_name ASC`,
    [conversationId]
  );
}

function sanitizeText(content, max = 4000) {
  return String(content || '').trim().slice(0, max);
}

function normalizeAttachment(attachment) {
  if (!attachment) {
    return {
      attachment_name: '',
      attachment_type: '',
      attachment_data: '',
      attachment_size: 0,
    };
  }

  const attachmentName = String(attachment.name || 'file').slice(0, 180);
  const attachmentType = String(attachment.type || 'application/octet-stream').slice(0, 120);
  const attachmentData = String(attachment.data || '');
  const attachmentSize = Number(attachment.size || 0);

  if (!/^data:[^;]+;base64,/.test(attachmentData)) {
    throw new Error('ไฟล์แนบไม่ถูกต้อง');
  }
  if (!Number.isFinite(attachmentSize) || attachmentSize <= 0 || attachmentSize > MAX_ATTACHMENT_BYTES) {
    throw new Error('ไฟล์ต้องไม่เกิน 5MB');
  }

  return {
    attachment_name: attachmentName,
    attachment_type: attachmentType,
    attachment_data: attachmentData,
    attachment_size: attachmentSize,
  };
}

async function insertMessage({ conversationId, senderId, content, msgType, attachment }) {
  const normalizedAttachment = normalizeAttachment(attachment);
  const result = await db.run(
    `INSERT INTO messages (
      conversation_id, sender_id, content, msg_type,
      attachment_name, attachment_type, attachment_data, attachment_size
    ) VALUES (?,?,?,?,?,?,?,?)`,
    [
      conversationId,
      senderId,
      content,
      msgType,
      normalizedAttachment.attachment_name,
      normalizedAttachment.attachment_type,
      normalizedAttachment.attachment_data,
      normalizedAttachment.attachment_size,
    ]
  );

  return db.get(
    `SELECT m.id, m.conversation_id, m.sender_id, m.content, m.msg_type, m.sent_at, m.is_read,
            m.attachment_name, m.attachment_type, m.attachment_data, m.attachment_size,
            u.display_name AS sender_name, u.avatar_url AS sender_avatar
     FROM messages m
     JOIN users u ON u.id = m.sender_id
     WHERE m.id = ?`,
    [result.lastID]
  );
}

function mapMessageForDirect(message, peerUserId) {
  return {
    ...message,
    conversation_kind: 'direct',
    peer_user_id: peerUserId,
  };
}

function mapMessageForGroup(message, conversationTitle) {
  return {
    ...message,
    conversation_kind: 'group',
    conversation_title: conversationTitle,
  };
}

router.get('/conversations', auth, async (req, res) => {
  const conversations = await db.all(`
    SELECT c.id,
      (SELECT content FROM messages WHERE conversation_id = c.id ORDER BY sent_at DESC, id DESC LIMIT 1) AS last_msg,
      (SELECT sent_at FROM messages WHERE conversation_id = c.id ORDER BY sent_at DESC, id DESC LIMIT 1) AS last_time,
      (SELECT COUNT(*) FROM messages WHERE conversation_id = c.id AND is_read = 0 AND sender_id != ?) AS unread,
      u.id AS partner_id, u.msn_id, u.username, u.display_name, u.status, u.avatar_url
    FROM conversations c
    JOIN conversation_members cm ON cm.conversation_id = c.id AND cm.user_id = ?
    JOIN conversation_members cm2 ON cm2.conversation_id = c.id AND cm2.user_id != ?
    JOIN users u ON u.id = cm2.user_id
    WHERE ${IS_GROUP_FALSE_SQL}
    ORDER BY COALESCE(last_time, 0) DESC, c.id DESC
  `, [req.user.userId, req.user.userId, req.user.userId]);

  return res.json({ ok: true, conversations });
});

router.get('/groups', auth, async (req, res) => {
  const groups = await db.all(`
    SELECT c.id, c.title, c.owner_id,
      (SELECT COUNT(*) FROM conversation_members cm WHERE cm.conversation_id = c.id) AS member_count,
      (SELECT content FROM messages WHERE conversation_id = c.id ORDER BY sent_at DESC, id DESC LIMIT 1) AS last_msg,
      (SELECT sent_at FROM messages WHERE conversation_id = c.id ORDER BY sent_at DESC, id DESC LIMIT 1) AS last_time
    FROM conversations c
    JOIN conversation_members cm ON cm.conversation_id = c.id AND cm.user_id = ?
    WHERE ${IS_GROUP_TRUE_SQL}
    ORDER BY COALESCE(last_time, 0) DESC, c.id DESC
  `, [req.user.userId]);

  return res.json({ ok: true, groups });
});

router.post('/groups', auth, async (req, res) => {
  const title = sanitizeText(req.body.title, 50);
  const requestedMemberIds = Array.from(new Set((req.body.member_ids || []).map((value) => Number(value)).filter(Boolean)));

  if (!title) {
    return res.status(400).json({ error: 'กรุณาตั้งชื่อกลุ่ม' });
  }
  if (!requestedMemberIds.length) {
    return res.status(400).json({ error: 'กรุณาเลือกเพื่อนอย่างน้อย 1 คน' });
  }

  const acceptedFriends = await db.all(
    `SELECT CASE WHEN user_id = ? THEN friend_id ELSE user_id END AS friend_id
     FROM friends
     WHERE status = 'accepted' AND (user_id = ? OR friend_id = ?)`,
    [req.user.userId, req.user.userId, req.user.userId]
  );
  const acceptedSet = new Set(acceptedFriends.map((row) => Number(row.friend_id)));
  const invalidMember = requestedMemberIds.find((memberId) => !acceptedSet.has(memberId));

  if (invalidMember) {
    return res.status(403).json({ error: 'มีสมาชิกที่ไม่ใช่เพื่อนอยู่ในรายการ' });
  }

  const conversation = await db.run(
    'INSERT INTO conversations (title, owner_id, is_group) VALUES (?,?,1)',
    [title, req.user.userId]
  );

  const memberIds = [req.user.userId, ...requestedMemberIds];
  await db.run(
    `INSERT INTO conversation_members (conversation_id, user_id) VALUES ${memberIds.map(() => '(?,?)').join(',')}`,
    memberIds.flatMap((memberId) => [conversation.lastID, memberId])
  );

  const group = await getGroup(conversation.lastID);
  return res.status(201).json({ ok: true, group });
});

router.get('/groups/:conversationId/members', auth, async (req, res) => {
  const conversationId = Number(req.params.conversationId);
  const member = await requireConversationMember(conversationId, req.user.userId);
  const group = await getGroup(conversationId);

  if (!member || !group) {
    return res.status(404).json({ error: 'ไม่พบกลุ่ม' });
  }

  const members = await getGroupMembers(conversationId);
  return res.json({ ok: true, owner_id: group.owner_id, members });
});

router.patch('/groups/:conversationId', auth, async (req, res) => {
  const conversationId = Number(req.params.conversationId);
  const title = sanitizeText(req.body.title, 50);
  const group = await getGroup(conversationId);

  if (!group) {
    return res.status(404).json({ error: 'ไม่พบกลุ่ม' });
  }
  if (Number(group.owner_id) !== Number(req.user.userId)) {
    return res.status(403).json({ error: 'เฉพาะเจ้าของกลุ่มเท่านั้น' });
  }
  if (!title) {
    return res.status(400).json({ error: 'กรุณาตั้งชื่อกลุ่ม' });
  }

  await db.run('UPDATE conversations SET title = ? WHERE id = ?', [title, conversationId]);
  const updatedGroup = await getGroup(conversationId);
  return res.json({ ok: true, group: updatedGroup });
});

router.post('/groups/:conversationId/invite', auth, async (req, res) => {
  const conversationId = Number(req.params.conversationId);
  const group = await getGroup(conversationId);

  if (!group) {
    return res.status(404).json({ error: 'ไม่พบกลุ่ม' });
  }
  if (Number(group.owner_id) !== Number(req.user.userId)) {
    return res.status(403).json({ error: 'เฉพาะเจ้าของกลุ่มเท่านั้น' });
  }

  const requestedMemberIds = Array.from(new Set((req.body.member_ids || []).map((value) => Number(value)).filter(Boolean)));
  if (!requestedMemberIds.length) {
    return res.status(400).json({ error: 'ไม่มีสมาชิกที่จะเชิญ' });
  }

  const currentMembers = await getGroupMembers(conversationId);
  const currentMemberSet = new Set(currentMembers.map((member) => Number(member.id)));
  const acceptedFriends = await db.all(
    `SELECT CASE WHEN user_id = ? THEN friend_id ELSE user_id END AS friend_id
     FROM friends
     WHERE status = 'accepted' AND (user_id = ? OR friend_id = ?)`,
    [req.user.userId, req.user.userId, req.user.userId]
  );
  const acceptedSet = new Set(acceptedFriends.map((row) => Number(row.friend_id)));
  const invitedMembers = requestedMemberIds.filter((memberId) => acceptedSet.has(memberId) && !currentMemberSet.has(memberId));

  if (!invitedMembers.length) {
    return res.status(400).json({ error: 'ไม่มีสมาชิกใหม่ที่เชิญได้' });
  }

  await db.run(
    `INSERT INTO conversation_members (conversation_id, user_id) VALUES ${invitedMembers.map(() => '(?,?)').join(',')}`,
    invitedMembers.flatMap((memberId) => [conversationId, memberId])
  );

  const members = await getGroupMembers(conversationId);
  return res.json({ ok: true, members });
});

router.delete('/groups/:conversationId/members/:memberId', auth, async (req, res) => {
  const conversationId = Number(req.params.conversationId);
  const memberId = Number(req.params.memberId);
  const group = await getGroup(conversationId);

  if (!group) {
    return res.status(404).json({ error: 'ไม่พบกลุ่ม' });
  }
  if (Number(group.owner_id) !== Number(req.user.userId)) {
    return res.status(403).json({ error: 'เฉพาะเจ้าของกลุ่มเท่านั้น' });
  }
  if (memberId === Number(req.user.userId)) {
    return res.status(400).json({ error: 'เจ้าของกลุ่มต้องใช้ Leave Group แทน' });
  }

  await db.run('DELETE FROM conversation_members WHERE conversation_id = ? AND user_id = ?', [conversationId, memberId]);
  const members = await getGroupMembers(conversationId);
  return res.json({ ok: true, members });
});

router.post('/groups/:conversationId/leave', auth, async (req, res) => {
  const conversationId = Number(req.params.conversationId);
  const group = await getGroup(conversationId);

  if (!group) {
    return res.status(404).json({ error: 'ไม่พบกลุ่ม' });
  }

  await db.run('DELETE FROM conversation_members WHERE conversation_id = ? AND user_id = ?', [conversationId, req.user.userId]);

  if (Number(group.owner_id) === Number(req.user.userId)) {
    const nextOwner = await db.get(
      'SELECT user_id FROM conversation_members WHERE conversation_id = ? ORDER BY user_id ASC LIMIT 1',
      [conversationId]
    );
    await db.run('UPDATE conversations SET owner_id = ? WHERE id = ?', [nextOwner ? nextOwner.user_id : null, conversationId]);
  }

  const remainingMembers = await db.get('SELECT COUNT(*) AS total FROM conversation_members WHERE conversation_id = ?', [conversationId]);
  if (!remainingMembers || Number(remainingMembers.total) === 0) {
    await db.run('DELETE FROM conversations WHERE id = ?', [conversationId]);
  }

  return res.json({ ok: true });
});

router.get('/conversations/:conversationId/messages', auth, async (req, res) => {
  const conversationId = Number(req.params.conversationId);
  const limit = Math.min(Number(req.query.limit) || 50, 100);
  const before = Number(req.query.before) || 9999999999;
  const member = await requireConversationMember(conversationId, req.user.userId);
  const group = await getGroup(conversationId);

  if (!member || !group) {
    return res.status(404).json({ error: 'ไม่พบกลุ่ม' });
  }

  const messages = (await db.all(`
    SELECT m.id, m.sender_id, m.content, m.msg_type, m.sent_at, m.is_read,
           m.attachment_name, m.attachment_type, m.attachment_data, m.attachment_size,
           u.display_name AS sender_name, u.avatar_url AS sender_avatar
    FROM messages m
    JOIN users u ON u.id = m.sender_id
    WHERE m.conversation_id = ? AND m.sent_at < ?
    ORDER BY m.sent_at DESC, m.id DESC
    LIMIT ?
  `, [conversationId, before, limit])).reverse().map((message) => mapMessageForGroup(message, group.title));

  await db.run(
    'UPDATE messages SET is_read = 1 WHERE conversation_id = ? AND sender_id != ? AND is_read = 0',
    [conversationId, req.user.userId]
  );

  return res.json({ ok: true, conversation_id: conversationId, messages });
});

router.post('/conversations/:conversationId/send', auth, async (req, res) => {
  const conversationId = Number(req.params.conversationId);
  const content = sanitizeText(req.body.content);
  const msgType = req.body.msg_type || 'text';
  const member = await requireConversationMember(conversationId, req.user.userId);
  const group = await getGroup(conversationId);

  if (!member || !group) {
    return res.status(404).json({ error: 'ไม่พบกลุ่ม' });
  }
  if (!MESSAGE_TYPES.has(msgType) || msgType === 'file') {
    return res.status(400).json({ error: 'ประเภทข้อความไม่ถูกต้อง' });
  }
  if (!content) {
    return res.status(400).json({ error: 'กรุณากรอกข้อความ' });
  }

  const inserted = await insertMessage({
    conversationId,
    senderId: req.user.userId,
    content,
    msgType,
  });

  return res.status(201).json({ ok: true, message: mapMessageForGroup(inserted, group.title) });
});

router.post('/conversations/:conversationId/send-file', auth, async (req, res) => {
  const conversationId = Number(req.params.conversationId);
  const content = sanitizeText(req.body.caption || req.body.content);
  const member = await requireConversationMember(conversationId, req.user.userId);
  const group = await getGroup(conversationId);

  if (!member || !group) {
    return res.status(404).json({ error: 'ไม่พบกลุ่ม' });
  }

  try {
    const inserted = await insertMessage({
      conversationId,
      senderId: req.user.userId,
      content,
      msgType: 'file',
      attachment: req.body.attachment,
    });

    return res.status(201).json({ ok: true, message: mapMessageForGroup(inserted, group.title) });
  } catch (error) {
    return res.status(400).json({ error: error.message || 'อัปโหลดไฟล์ไม่สำเร็จ' });
  }
});

router.get('/:friendId/messages', auth, async (req, res) => {
  const friendId = Number(req.params.friendId);
  const limit = Math.min(Number(req.query.limit) || 50, 100);
  const before = Number(req.query.before) || 9999999999;

  const friendship = await requireAcceptedFriendship(req.user.userId, friendId);
  if (!friendship) {
    return res.status(403).json({ error: 'ต้องเป็นเพื่อนกันก่อนจึงดูข้อความได้' });
  }

  const conversationId = await getOrCreateConv(req.user.userId, friendId);
  const messages = (await db.all(`
    SELECT m.id, m.sender_id, m.content, m.msg_type, m.sent_at, m.is_read,
           m.attachment_name, m.attachment_type, m.attachment_data, m.attachment_size,
           u.display_name AS sender_name, u.avatar_url AS sender_avatar
    FROM messages m
    JOIN users u ON u.id = m.sender_id
    WHERE m.conversation_id = ? AND m.sent_at < ?
    ORDER BY m.sent_at DESC, m.id DESC
    LIMIT ?
  `, [conversationId, before, limit])).reverse().map((message) => mapMessageForDirect(message, friendId));

  await db.run(
    'UPDATE messages SET is_read = 1 WHERE conversation_id = ? AND sender_id != ? AND is_read = 0',
    [conversationId, req.user.userId]
  );

  return res.json({ ok: true, conversation_id: conversationId, messages });
});

router.post('/:friendId/send', auth, async (req, res) => {
  const friendId = Number(req.params.friendId);
  const content = sanitizeText(req.body.content);
  const msgType = req.body.msg_type || 'text';

  if (!MESSAGE_TYPES.has(msgType) || msgType === 'file') {
    return res.status(400).json({ error: 'ประเภทข้อความไม่ถูกต้อง' });
  }
  if (!content) {
    return res.status(400).json({ error: 'กรุณากรอกข้อความ' });
  }

  const friendship = await requireAcceptedFriendship(req.user.userId, friendId);
  if (!friendship) {
    return res.status(403).json({ error: 'ต้องเป็นเพื่อนกันก่อนจึงส่งข้อความได้' });
  }

  const conversationId = await getOrCreateConv(req.user.userId, friendId);
  const inserted = await insertMessage({
    conversationId,
    senderId: req.user.userId,
    content,
    msgType,
  });

  return res.status(201).json({ ok: true, message: mapMessageForDirect(inserted, friendId) });
});

router.post('/:friendId/send-file', auth, async (req, res) => {
  const friendId = Number(req.params.friendId);
  const content = sanitizeText(req.body.caption || req.body.content);
  const friendship = await requireAcceptedFriendship(req.user.userId, friendId);

  if (!friendship) {
    return res.status(403).json({ error: 'ต้องเป็นเพื่อนกันก่อนจึงส่งไฟล์ได้' });
  }

  try {
    const conversationId = await getOrCreateConv(req.user.userId, friendId);
    const inserted = await insertMessage({
      conversationId,
      senderId: req.user.userId,
      content,
      msgType: 'file',
      attachment: req.body.attachment,
    });

    return res.status(201).json({ ok: true, message: mapMessageForDirect(inserted, friendId) });
  } catch (error) {
    return res.status(400).json({ error: error.message || 'อัปโหลดไฟล์ไม่สำเร็จ' });
  }
});

module.exports = {
  router,
  getOrCreateConv,
  requireAcceptedFriendship,
  requireConversationMember,
  insertMessage,
  getGroup,
  getGroupMembers,
  mapMessageForDirect,
  mapMessageForGroup,
  MAX_ATTACHMENT_BYTES,
};
