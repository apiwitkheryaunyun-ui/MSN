const express = require('express');
const router = express.Router();
const db = require('../db/schema');
const auth = require('../middleware');
const rateLimit = require('../middleware/rateLimit');
const { isValidMsnId } = require('../validators');

// GET /api/friends - list accepted friends
router.get('/', auth, async (req, res) => {
  const friends = await db.all(`
    SELECT u.id, u.msn_id, u.username, u.display_name, u.status, u.status_msg, u.avatar_url
    FROM friends f
    JOIN users u ON (
      CASE WHEN f.user_id = ? THEN f.friend_id ELSE f.user_id END = u.id
    )
    WHERE (f.user_id = ? OR f.friend_id = ?)
      AND f.status = 'accepted'
    ORDER BY u.status = 'online' DESC, u.display_name ASC
  `, [req.user.userId, req.user.userId, req.user.userId]);
  return res.json({ ok: true, friends });
});

// GET /api/friends/requests - pending requests received
router.get('/requests', auth, async (req, res) => {
  const requests = await db.all(`
    SELECT f.id AS req_id, u.id, u.msn_id, u.username, u.display_name, u.avatar_url, f.created_at
    FROM friends f
    JOIN users u ON f.user_id = u.id
    WHERE f.friend_id = ? AND f.status = 'pending'
    ORDER BY f.created_at DESC
  `, [req.user.userId]);
  return res.json({ ok: true, requests });
});

// POST /api/friends/add - send friend request by msn_id
router.post('/add', auth, rateLimit({ key: 'friends-add', limit: 25, windowMs: 60 * 60_000 }), async (req, res) => {
  const { msn_id } = req.body;
  if (!isValidMsnId(msn_id)) {
    return res.status(400).json({ error: 'MSN ID ไม่ถูกต้อง' });
  }

  const target = await db.get(`
    SELECT u.id, COALESCE(s.allow_friend_requests, 1) AS allow_friend_requests
    FROM users u
    LEFT JOIN user_settings s ON s.user_id = u.id
    WHERE u.msn_id = ?
  `, [msn_id]);
  if (!target) return res.status(404).json({ error: 'ไม่พบผู้ใช้หมายเลขนี้' });
  if (target.id === req.user.userId) return res.status(400).json({ error: 'ไม่สามารถเพิ่มตัวเองเป็นเพื่อนได้' });
  if (!target.allow_friend_requests) return res.status(403).json({ error: 'ผู้ใช้นี้ปิดรับคำขอเป็นเพื่อน' });

  const existing = await db.get(
    'SELECT id, status FROM friends WHERE (user_id=? AND friend_id=?) OR (user_id=? AND friend_id=?)',
    [req.user.userId, target.id, target.id, req.user.userId]
  );

  if (existing) {
    if (existing.status === 'accepted') return res.status(409).json({ error: 'เป็นเพื่อนกันอยู่แล้ว' });
    if (existing.status === 'pending') return res.status(409).json({ error: 'มีคำขอรอการตอบรับอยู่แล้ว' });
    if (existing.status === 'blocked') return res.status(409).json({ error: 'ไม่สามารถเพิ่มได้' });
  }

  await db.run("INSERT INTO friends (user_id, friend_id, status) VALUES (?, ?, 'pending')",
    [req.user.userId, target.id]);
  return res.status(201).json({ ok: true, message: 'ส่งคำขอเป็นเพื่อนแล้ว' });
});

// POST /api/friends/accept/:req_id
router.post('/accept/:req_id', auth, async (req, res) => {
  const row = await db.get('SELECT * FROM friends WHERE id = ?', [req.params.req_id]);
  if (!row || row.friend_id !== req.user.userId) {
    return res.status(404).json({ error: 'ไม่พบคำขอ' });
  }
  await db.run("UPDATE friends SET status='accepted' WHERE id=?", [row.id]);
  return res.json({ ok: true });
});

// POST /api/friends/reject/:req_id
router.post('/reject/:req_id', auth, async (req, res) => {
  const row = await db.get('SELECT * FROM friends WHERE id = ?', [req.params.req_id]);
  if (!row || row.friend_id !== req.user.userId) {
    return res.status(404).json({ error: 'ไม่พบคำขอ' });
  }
  await db.run('DELETE FROM friends WHERE id=?', [row.id]);
  return res.json({ ok: true });
});

// DELETE /api/friends/:friend_id - remove friend
router.delete('/:friend_id', auth, async (req, res) => {
  const fid = parseInt(req.params.friend_id);
  await db.run(
    "DELETE FROM friends WHERE status='accepted' AND ((user_id=? AND friend_id=?) OR (user_id=? AND friend_id=?))",
    [req.user.userId, fid, fid, req.user.userId]
  );
  return res.json({ ok: true });
});

module.exports = router;
