const express = require('express');
const router = express.Router();
const db = require('../db/schema');
const auth = require('../middleware');
const {
  isValidTheme,
  isValidPrivacyMode,
  normalizeBoolean,
} = require('../validators');

async function ensureSettings(userId) {
  await db.run(
    `INSERT INTO user_settings (user_id)
     SELECT ?
     WHERE NOT EXISTS (SELECT 1 FROM user_settings WHERE user_id = ?)`,
    [userId, userId]
  );

  return db.get('SELECT * FROM user_settings WHERE user_id = ?', [userId]);
}

router.get('/me', auth, async (req, res) => {
  const settings = await ensureSettings(req.user.userId);
  return res.json({ ok: true, settings });
});

router.patch('/me', auth, async (req, res) => {
  const updates = [];
  const params = [];
  const { theme, sounds_enabled, allow_friend_requests, allow_file_transfer, privacy_mode } = req.body;

  if (theme !== undefined) {
    if (!isValidTheme(theme)) return res.status(400).json({ error: 'ธีมไม่ถูกต้อง' });
    updates.push('theme = ?');
    params.push(theme);
  }
  if (sounds_enabled !== undefined) {
    updates.push('sounds_enabled = ?');
    params.push(normalizeBoolean(sounds_enabled));
  }
  if (allow_friend_requests !== undefined) {
    updates.push('allow_friend_requests = ?');
    params.push(normalizeBoolean(allow_friend_requests));
  }
  if (allow_file_transfer !== undefined) {
    updates.push('allow_file_transfer = ?');
    params.push(normalizeBoolean(allow_file_transfer));
  }
  if (privacy_mode !== undefined) {
    if (!isValidPrivacyMode(privacy_mode)) return res.status(400).json({ error: 'ค่าความเป็นส่วนตัวไม่ถูกต้อง' });
    updates.push('privacy_mode = ?');
    params.push(privacy_mode);
  }

  if (!updates.length) {
    return res.status(400).json({ error: 'ไม่มีค่าที่จะอัปเดต' });
  }

  await ensureSettings(req.user.userId);
  params.push(req.user.userId);
  await db.run(`UPDATE user_settings SET ${updates.join(', ')} WHERE user_id = ?`, params);

  const settings = await ensureSettings(req.user.userId);
  return res.json({ ok: true, settings });
});

module.exports = router;
