const express = require('express');
const router = express.Router();
const db = require('../db/schema');
const auth = require('../middleware');

// GET /api/users/search?msn_id=XXXXXXXXXX
router.get('/search', auth, async (req, res) => {
  const { msn_id } = req.query;
  if (!msn_id || !/^\d{10}$/.test(msn_id)) {
    return res.status(400).json({ error: 'MSN ID ต้องเป็นตัวเลข 10 หลัก' });
  }
  if (msn_id === req.user.msn_id) {
    return res.status(400).json({ error: 'ไม่สามารถค้นหาตัวเองได้' });
  }
  const user = await db.get(
    'SELECT id, msn_id, username, display_name, status, status_msg, avatar_url FROM users WHERE msn_id = ?',
    [msn_id]
  );
  if (!user) return res.status(404).json({ error: 'ไม่พบผู้ใช้' });
  return res.json({ ok: true, user });
});

// GET /api/users/profile/:msn_id
router.get('/profile/:msn_id', auth, async (req, res) => {
  const user = await db.get(
    'SELECT id, msn_id, username, display_name, status, status_msg, avatar_url, created_at FROM users WHERE msn_id = ?',
    [req.params.msn_id]
  );
  if (!user) return res.status(404).json({ error: 'ไม่พบผู้ใช้' });
  return res.json({ ok: true, user });
});

// PATCH /api/users/me  — update own profile
router.patch('/me', auth, async (req, res) => {
  const { display_name, status_msg, status, avatar_url } = req.body;
  const validStatuses = ['online', 'away', 'busy', 'be right back', 'appear offline'];
  const updates = [];
  const vals = [];

  if (display_name !== undefined) {
    updates.push('display_name = ?'); vals.push(String(display_name).trim().slice(0, 50));
  }
  if (status_msg !== undefined) {
    updates.push('status_msg = ?'); vals.push(String(status_msg).slice(0, 140));
  }
  if (status !== undefined && validStatuses.includes(status)) {
    updates.push('status = ?'); vals.push(status);
  }
  if (avatar_url !== undefined) {
    // Only allow data URLs (base64) or empty string — no external URLs
    if (avatar_url === '' || /^data:image\/(png|jpeg|gif|webp);base64,/.test(avatar_url)) {
      updates.push('avatar_url = ?'); vals.push(avatar_url.slice(0, 80000));
    }
  }

  if (!updates.length) return res.status(400).json({ error: 'ไม่มีข้อมูลที่จะอัปเดต' });

  vals.push(req.user.userId);
  await db.run(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`, vals);

  const user = await db.get(
    'SELECT id, msn_id, username, display_name, status, status_msg, avatar_url FROM users WHERE id=?',
    [req.user.userId]
  );
  return res.json({ ok: true, user });
});

module.exports = router;
