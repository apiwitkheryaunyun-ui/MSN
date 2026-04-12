const express = require('express');
const router = express.Router();
const db = require('../db/schema');
const auth = require('../middleware');
const {
  isValidMsnId,
  sanitizeDisplayName,
  sanitizeStatusMessage,
  isValidStatus,
} = require('../validators');

async function areAcceptedFriends(userId, otherUserId) {
  const link = await db.get(
    "SELECT id FROM friends WHERE status='accepted' AND ((user_id=? AND friend_id=?) OR (user_id=? AND friend_id=?))",
    [userId, otherUserId, otherUserId, userId]
  );
  return !!link;
}

// GET /api/users/search?msn_id=XXXXXXXXXX
router.get('/search', auth, async (req, res) => {
  const { msn_id } = req.query;
  if (!isValidMsnId(msn_id)) {
    return res.status(400).json({ error: 'MSN ID ต้องเป็นตัวเลข 10 หลัก' });
  }
  if (msn_id === req.user.msn_id) {
    return res.status(400).json({ error: 'ไม่สามารถค้นหาตัวเองได้' });
  }
  const user = await db.get(
    `SELECT u.id, u.msn_id, u.username, u.display_name, u.status, u.status_msg, u.avatar_url,
            COALESCE(s.privacy_mode, 'everyone') AS privacy_mode
     FROM users u
     LEFT JOIN user_settings s ON s.user_id = u.id
     WHERE u.msn_id = ?`,
    [msn_id]
  );
  if (!user) return res.status(404).json({ error: 'ไม่พบผู้ใช้' });
  if (user.privacy_mode === 'contacts-only') {
    const isFriend = await areAcceptedFriends(req.user.userId, user.id);
    if (!isFriend) {
      return res.status(403).json({ error: 'ผู้ใช้นี้เปิดโปรไฟล์เฉพาะเพื่อนเท่านั้น' });
    }
  }
  delete user.privacy_mode;
  return res.json({ ok: true, user });
});

// GET /api/users/profile/:msn_id
router.get('/profile/:msn_id', auth, async (req, res) => {
  const user = await db.get(
    `SELECT u.id, u.msn_id, u.username, u.display_name, u.status, u.status_msg, u.avatar_url, u.created_at,
            COALESCE(s.privacy_mode, 'everyone') AS privacy_mode
     FROM users u
     LEFT JOIN user_settings s ON s.user_id = u.id
     WHERE u.msn_id = ?`,
    [req.params.msn_id]
  );
  if (!user) return res.status(404).json({ error: 'ไม่พบผู้ใช้' });
  if (Number(user.id) !== Number(req.user.userId) && user.privacy_mode === 'contacts-only') {
    const isFriend = await areAcceptedFriends(req.user.userId, user.id);
    if (!isFriend) {
      return res.status(403).json({ error: 'ผู้ใช้นี้เปิดโปรไฟล์เฉพาะเพื่อนเท่านั้น' });
    }
  }
  delete user.privacy_mode;
  return res.json({ ok: true, user });
});

// PATCH /api/users/me  — update own profile
router.patch('/me', auth, async (req, res) => {
  const { display_name, status_msg, status, avatar_url } = req.body;
  const updates = [];
  const vals = [];

  if (display_name !== undefined) {
    updates.push('display_name = ?'); vals.push(sanitizeDisplayName(display_name));
  }
  if (status_msg !== undefined) {
    updates.push('status_msg = ?'); vals.push(sanitizeStatusMessage(status_msg));
  }
  if (status !== undefined && isValidStatus(status)) {
    updates.push('status = ?'); vals.push(status);
  }
  if (avatar_url !== undefined) {
    // Only allow data URLs (base64) or empty string — no external URLs
    const avatarValue = String(avatar_url || '');
    if (avatarValue === '' || /^data:image\/(png|jpe?g|gif|webp);base64,/i.test(avatarValue)) {
      updates.push('avatar_url = ?'); vals.push(avatarValue.slice(0, 2500000));
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
