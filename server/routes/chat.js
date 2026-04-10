const express = require('express');
const router = express.Router();
const db = require('../db/schema');
const auth = require('../middleware');

// Get or create 1-on-1 conversation  (async)
async function getOrCreateConv(userId, friendId) {
  const existing = await db.get(`
    SELECT c.id FROM conversations c
    JOIN conversation_members m1 ON m1.conversation_id = c.id AND m1.user_id = ?
    JOIN conversation_members m2 ON m2.conversation_id = c.id AND m2.user_id = ?
    WHERE (SELECT COUNT(*) FROM conversation_members WHERE conversation_id = c.id) = 2
    LIMIT 1
  `, [userId, friendId]);

  if (existing) return existing.id;

  const conv = await db.run('INSERT INTO conversations DEFAULT VALUES', []);
  await db.run(
    'INSERT INTO conversation_members (conversation_id, user_id) VALUES (?,?),(?,?)',
    [conv.lastID, userId, conv.lastID, friendId]
  );
  return conv.lastID;
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

// GET /api/chat/:friendId/messages?before=<timestamp>&limit=50
router.get('/:friendId/messages', auth, async (req, res) => {
  const friendId = parseInt(req.params.friendId);
  const limit = Math.min(parseInt(req.query.limit) || 50, 100);
  const before = parseInt(req.query.before) || 9999999999;

  const convId = await getOrCreateConv(req.user.userId, friendId);

  const messages = (await db.all(`
    SELECT m.id, m.sender_id, m.content, m.msg_type, m.sent_at, m.is_read,
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
router.post('/:friendId/send', auth, async (req, res) => {
  const friendId = parseInt(req.params.friendId);
  const { content, msg_type = 'text' } = req.body;

  if (!content || !String(content).trim()) {
    return res.status(400).json({ error: 'ข้อความว่าง' });
  }
  if (!['text', 'nudge', 'wink'].includes(msg_type)) {
    return res.status(400).json({ error: 'ประเภทข้อความไม่ถูกต้อง' });
  }

  const friendship = await db.get(
    "SELECT id FROM friends WHERE status='accepted' AND ((user_id=? AND friend_id=?) OR (user_id=? AND friend_id=?))",
    [req.user.userId, friendId, friendId, req.user.userId]
  );
  if (!friendship) return res.status(403).json({ error: 'ต้องเป็นเพื่อนกันก่อนจึงส่งข้อความได้' });

  const convId = await getOrCreateConv(req.user.userId, friendId);
  const safe = String(content).slice(0, 4000);

  const msg = await db.run(
    'INSERT INTO messages (conversation_id, sender_id, content, msg_type) VALUES (?,?,?,?)',
    [convId, req.user.userId, safe, msg_type]
  );

  const inserted = await db.get('SELECT * FROM messages WHERE id=?', [msg.lastID]);
  return res.status(201).json({ ok: true, message: inserted });
});

module.exports = { router, getOrCreateConv };
