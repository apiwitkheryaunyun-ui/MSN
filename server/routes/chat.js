const express = require('express');
const router = express.Router();
const db = require('../db/schema');
const auth = require('../middleware');
const rateLimit = require('../middleware/rateLimit');
const {
  isValidMessageType,
  sanitizeText,
  sanitizeConversationTitle,
  validateAttachment,
} = require('../validators');
const {
  ensureAcceptedFriendship,
  getConversationById,
  ensureConversationMember,
  getOrCreateDirectConversation,
  createGroupConversation,
  createMessage,
} = require('../services/chatService');

async function getOrCreateConv(userId, friendId) {
  return getOrCreateDirectConversation(userId, friendId);
}

// GET /api/chat/conversations
router.get('/conversations', auth, async (req, res) => {
  const convs = await db.all(`
    SELECT c.id,
      (SELECT content FROM messages WHERE conversation_id=c.id ORDER BY sent_at DESC LIMIT 1) AS last_msg,
      (SELECT sent_at FROM messages WHERE conversation_id=c.id ORDER BY sent_at DESC LIMIT 1) AS last_time,
      (SELECT COUNT(*) FROM messages WHERE conversation_id=c.id AND is_read=0 AND sender_id != ?) AS unread,
      u.id AS partner_id, u.msn_id, u.username, u.display_name, u.status, u.avatar_url
    FROM conversations c
    JOIN conversation_members cm ON cm.conversation_id=c.id AND cm.user_id=?
    JOIN conversation_members cm2 ON cm2.conversation_id=c.id AND cm2.user_id != ?
    JOIN users u ON u.id=cm2.user_id
    ORDER BY last_time DESC NULLS LAST
  `, [req.user.userId, req.user.userId, req.user.userId]);
  return res.json({ ok: true, conversations: convs });
});

router.get('/groups', auth, async (req, res) => {
  const groups = await db.all(`
    SELECT c.id, c.title, c.owner_id, c.created_at,
      (SELECT COUNT(*) FROM conversation_members WHERE conversation_id = c.id) AS member_count,
      (SELECT content FROM messages WHERE conversation_id = c.id ORDER BY sent_at DESC LIMIT 1) AS last_msg,
      (SELECT sent_at FROM messages WHERE conversation_id = c.id ORDER BY sent_at DESC LIMIT 1) AS last_time
    FROM conversations c
    JOIN conversation_members cm ON cm.conversation_id = c.id
    WHERE cm.user_id = ? AND c.kind = 'group'
    ORDER BY c.created_at DESC
  `, [req.user.userId]);
  return res.json({ ok: true, groups });
});

router.post('/groups', auth, rateLimit({ key: 'groups-create', limit: 12, windowMs: 60 * 60_000 }), async (req, res) => {
  try {
    const title = sanitizeConversationTitle(req.body.title);
    const memberIds = Array.isArray(req.body.member_ids) ? req.body.member_ids : [];
    const conversationId = await createGroupConversation(req.user.userId, title, memberIds);
    const group = await db.get('SELECT id, title, owner_id, kind, created_at FROM conversations WHERE id = ?', [conversationId]);
    return res.status(201).json({ ok: true, group });
  } catch (error) {
    return res.status(400).json({ error: error.message || 'ไม่สามารถสร้างกลุ่มได้' });
  }
});

router.get('/conversations/:conversationId/messages', auth, async (req, res) => {
  const conversationId = parseInt(req.params.conversationId, 10);
  const limit = Math.min(parseInt(req.query.limit, 10) || 50, 100);
  const before = parseInt(req.query.before, 10) || 9999999999;

  const conv = await getConversationById(conversationId);
  if (!conv || conv.kind !== 'group') {
    return res.status(404).json({ error: 'ไม่พบห้องแชตกลุ่ม' });
  }

  const member = await ensureConversationMember(conversationId, req.user.userId);
  if (!member) return res.status(403).json({ error: 'ไม่มีสิทธิ์เข้าถึงห้องนี้' });

  const messages = (await db.all(`
    SELECT m.id, m.sender_id, m.content, m.msg_type, m.sent_at, m.is_read,
           m.attachment_name, m.attachment_type, m.attachment_size, m.attachment_data,
           u.display_name AS sender_name, u.avatar_url AS sender_avatar
    FROM messages m
    JOIN users u ON u.id = m.sender_id
    WHERE m.conversation_id = ? AND m.sent_at < ?
    ORDER BY m.sent_at DESC
    LIMIT ?
  `, [conversationId, before, limit])).reverse();

  await db.run(
    'UPDATE messages SET is_read=1 WHERE conversation_id=? AND sender_id != ? AND is_read=0',
    [conversationId, req.user.userId]
  );

  return res.json({ ok: true, conversation_id: conversationId, messages });
});

// GET /api/chat/:friendId/messages?before=<timestamp>&limit=50
router.get('/:friendId/messages', auth, async (req, res) => {
  const friendId = parseInt(req.params.friendId, 10);
  const limit = Math.min(parseInt(req.query.limit, 10) || 50, 100);
  const before = parseInt(req.query.before, 10) || 9999999999;

  const friendship = await ensureAcceptedFriendship(req.user.userId, friendId);
  if (!friendship) return res.status(403).json({ error: 'ต้องเป็นเพื่อนกันก่อนจึงเปิดแชตได้' });

  const convId = await getOrCreateConv(req.user.userId, friendId);

  const messages = (await db.all(`
    SELECT m.id, m.sender_id, m.content, m.msg_type, m.sent_at, m.is_read,
           m.attachment_name, m.attachment_type, m.attachment_size, m.attachment_data,
           u.display_name AS sender_name, u.avatar_url AS sender_avatar
    FROM messages m
    JOIN users u ON u.id = m.sender_id
    WHERE m.conversation_id = ? AND m.sent_at < ?
    ORDER BY m.sent_at DESC
    LIMIT ?
  `, [convId, before, limit])).reverse();

  await db.run(
    'UPDATE messages SET is_read=1 WHERE conversation_id=? AND sender_id != ? AND is_read=0',
    [convId, req.user.userId]
  );

  return res.json({ ok: true, conversation_id: convId, messages });
});

// POST /api/chat/:friendId/send (REST fallback)
router.post('/:friendId/send', auth, rateLimit({ key: 'chat-send', limit: 160, windowMs: 60_000 }), async (req, res) => {
  const friendId = parseInt(req.params.friendId, 10);
  const { content, msg_type = 'text' } = req.body;

  if (!content || !String(content).trim()) {
    return res.status(400).json({ error: 'ข้อความว่าง' });
  }
  if (!isValidMessageType(msg_type) || msg_type === 'file') {
    return res.status(400).json({ error: 'ประเภทข้อความไม่ถูกต้อง' });
  }

  const friendship = await ensureAcceptedFriendship(req.user.userId, friendId);
  if (!friendship) return res.status(403).json({ error: 'ต้องเป็นเพื่อนกันก่อนจึงส่งข้อความได้' });

  const convId = await getOrCreateConv(req.user.userId, friendId);
  const inserted = await createMessage({
    conversationId: convId,
    senderId: req.user.userId,
    content: sanitizeText(content, 4000),
    msgType: msg_type,
  });
  return res.status(201).json({ ok: true, message: inserted });
});

router.post('/:friendId/send-file', auth, rateLimit({ key: 'chat-file', limit: 30, windowMs: 10 * 60_000 }), async (req, res) => {
  const friendId = parseInt(req.params.friendId, 10);
  const friendship = await ensureAcceptedFriendship(req.user.userId, friendId);
  if (!friendship) return res.status(403).json({ error: 'ต้องเป็นเพื่อนกันก่อนจึงส่งไฟล์ได้' });

  const validation = validateAttachment(req.body.attachment);
  if (!validation.ok) return res.status(400).json({ error: validation.error });

  const convId = await getOrCreateConv(req.user.userId, friendId);
  const inserted = await createMessage({
    conversationId: convId,
    senderId: req.user.userId,
    content: sanitizeText(req.body.caption, 280),
    msgType: 'file',
    attachment: validation.attachment,
  });
  return res.status(201).json({ ok: true, message: inserted });
});

router.post('/conversations/:conversationId/send', auth, rateLimit({ key: 'group-send', limit: 220, windowMs: 60_000 }), async (req, res) => {
  const conversationId = parseInt(req.params.conversationId, 10);
  const { content, msg_type = 'text' } = req.body;

  const conv = await getConversationById(conversationId);
  if (!conv || conv.kind !== 'group') return res.status(404).json({ error: 'ไม่พบห้องแชตกลุ่ม' });
  const member = await ensureConversationMember(conversationId, req.user.userId);
  if (!member) return res.status(403).json({ error: 'ไม่มีสิทธิ์ส่งข้อความในห้องนี้' });

  if (!content || !String(content).trim()) {
    return res.status(400).json({ error: 'ข้อความว่าง' });
  }
  if (!isValidMessageType(msg_type) || msg_type === 'file') {
    return res.status(400).json({ error: 'ประเภทข้อความไม่ถูกต้อง' });
  }

  const inserted = await createMessage({
    conversationId,
    senderId: req.user.userId,
    content: sanitizeText(content, 4000),
    msgType: msg_type,
  });
  return res.status(201).json({ ok: true, message: inserted });
});

router.post('/conversations/:conversationId/send-file', auth, rateLimit({ key: 'group-file', limit: 30, windowMs: 10 * 60_000 }), async (req, res) => {
  const conversationId = parseInt(req.params.conversationId, 10);
  const conv = await getConversationById(conversationId);
  if (!conv || conv.kind !== 'group') return res.status(404).json({ error: 'ไม่พบห้องแชตกลุ่ม' });
  const member = await ensureConversationMember(conversationId, req.user.userId);
  if (!member) return res.status(403).json({ error: 'ไม่มีสิทธิ์ส่งไฟล์ในห้องนี้' });

  const validation = validateAttachment(req.body.attachment);
  if (!validation.ok) return res.status(400).json({ error: validation.error });

  const inserted = await createMessage({
    conversationId,
    senderId: req.user.userId,
    content: sanitizeText(req.body.caption, 280),
    msgType: 'file',
    attachment: validation.attachment,
  });
  return res.status(201).json({ ok: true, message: inserted });
});

module.exports = { router, getOrCreateConv };
