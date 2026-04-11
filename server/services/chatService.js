'use strict';

const db = require('../db/schema');
const {
  sanitizeConversationTitle,
  sanitizeText,
  validateAttachment,
} = require('../validators');

async function ensureAcceptedFriendship(userId, friendId) {
  return db.get(
    "SELECT id FROM friends WHERE status='accepted' AND ((user_id=? AND friend_id=?) OR (user_id=? AND friend_id=?))",
    [userId, friendId, friendId, userId]
  );
}

async function getConversationById(conversationId) {
  return db.get('SELECT * FROM conversations WHERE id = ?', [conversationId]);
}

async function ensureConversationMember(conversationId, userId) {
  return db.get(
    'SELECT conversation_id FROM conversation_members WHERE conversation_id = ? AND user_id = ?',
    [conversationId, userId]
  );
}

async function getConversationRecipients(conversationId, excludeUserId) {
  return db.all(
    'SELECT user_id FROM conversation_members WHERE conversation_id = ? AND user_id != ?',
    [conversationId, excludeUserId]
  );
}

async function getOrCreateDirectConversation(userId, friendId) {
  const existing = await db.get(`
    SELECT c.id FROM conversations c
    JOIN conversation_members m1 ON m1.conversation_id = c.id AND m1.user_id = ?
    JOIN conversation_members m2 ON m2.conversation_id = c.id AND m2.user_id = ?
    WHERE c.kind = 'direct'
      AND (SELECT COUNT(*) FROM conversation_members WHERE conversation_id = c.id) = 2
    LIMIT 1
  `, [userId, friendId]);

  if (existing) return existing.id;

  const conv = await db.run(
    "INSERT INTO conversations (kind, title, owner_id) VALUES ('direct', '', ?)",
    [userId]
  );

  await db.run(
    'INSERT INTO conversation_members (conversation_id, user_id) VALUES (?,?),(?,?)',
    [conv.lastID, userId, conv.lastID, friendId]
  );

  return conv.lastID;
}

async function createGroupConversation(ownerId, title, memberIds) {
  const uniqueMembers = [...new Set(memberIds.map(Number).filter(Boolean))].filter(id => id !== ownerId);
  const cleanTitle = sanitizeConversationTitle(title);
  if (!cleanTitle) {
    throw new Error('ชื่อกลุ่มต้องมีอย่างน้อย 1 ตัวอักษร');
  }
  if (uniqueMembers.length < 1) {
    throw new Error('กรุณาเลือกเพื่อนอย่างน้อย 1 คน');
  }

  const placeholders = uniqueMembers.map(() => '?').join(',');
  const allowedFriends = await db.all(
    `SELECT CASE WHEN user_id = ? THEN friend_id ELSE user_id END AS friend_id
     FROM friends
     WHERE status = 'accepted' AND (user_id = ? OR friend_id = ?)
       AND CASE WHEN user_id = ? THEN friend_id ELSE user_id END IN (${placeholders})`,
    [ownerId, ownerId, ownerId, ownerId, ...uniqueMembers]
  );

  if (allowedFriends.length !== uniqueMembers.length) {
    throw new Error('สามารถเชิญได้เฉพาะเพื่อนที่ตอบรับแล้วเท่านั้น');
  }

  const conv = await db.run(
    "INSERT INTO conversations (kind, title, owner_id) VALUES ('group', ?, ?)",
    [cleanTitle, ownerId]
  );

  const members = [ownerId, ...uniqueMembers];
  const valuesSql = members.map(() => '(?, ?)').join(',');
  const params = members.flatMap(memberId => [conv.lastID, memberId]);
  await db.run(
    `INSERT INTO conversation_members (conversation_id, user_id) VALUES ${valuesSql}`,
    params
  );

  return conv.lastID;
}

async function createMessage({ conversationId, senderId, content, msgType = 'text', attachment = null }) {
  const validation = validateAttachment(attachment);
  if (!validation.ok) {
    throw new Error(validation.error);
  }

  const safeContent = sanitizeText(content, msgType === 'file' ? 280 : 4000);
  const file = validation.attachment || null;

  const info = await db.run(
    `INSERT INTO messages (
      conversation_id, sender_id, content, msg_type,
      attachment_name, attachment_type, attachment_size, attachment_data
    ) VALUES (?,?,?,?,?,?,?,?)`,
    [
      conversationId,
      senderId,
      safeContent,
      msgType,
      file?.name || '',
      file?.type || '',
      file?.size || 0,
      file?.data || ''
    ]
  );

  return db.get(`
    SELECT m.*, u.display_name AS sender_name, u.avatar_url AS sender_avatar
    FROM messages m
    JOIN users u ON u.id = m.sender_id
    WHERE m.id = ?
  `, [info.lastID]);
}

module.exports = {
  ensureAcceptedFriendship,
  getConversationById,
  ensureConversationMember,
  getConversationRecipients,
  getOrCreateDirectConversation,
  createGroupConversation,
  createMessage,
};
