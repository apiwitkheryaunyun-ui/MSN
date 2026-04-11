const express = require('express');
const router = express.Router();
const db = require('../db/schema');
const auth = require('../middleware');

const DEFAULT_SETTINGS = {
  theme: 'classic',
  privacy_mode: 'everyone',
  sounds_enabled: 1,
  allow_friend_requests: 1,
  allow_file_transfer: 1,
};

async function ensureSettings(userId) {
  const existing = await db.get('SELECT * FROM user_settings WHERE user_id = ?', [userId]);
  if (existing) {
    return { ...DEFAULT_SETTINGS, ...existing };
  }

  await db.run(
    `INSERT INTO user_settings (
      user_id, theme, privacy_mode, sounds_enabled, allow_friend_requests, allow_file_transfer
    ) VALUES (?,?,?,?,?,?)`,
    [
      userId,
      DEFAULT_SETTINGS.theme,
      DEFAULT_SETTINGS.privacy_mode,
      DEFAULT_SETTINGS.sounds_enabled,
      DEFAULT_SETTINGS.allow_friend_requests,
      DEFAULT_SETTINGS.allow_file_transfer,
    ]
  );

  return { user_id: userId, ...DEFAULT_SETTINGS };
}

router.get('/me', auth, async (req, res) => {
  const settings = await ensureSettings(req.user.userId);
  return res.json({ ok: true, settings });
});

router.patch('/me', auth, async (req, res) => {
  await ensureSettings(req.user.userId);

  const updates = [];
  const values = [];
  const allowedThemes = new Set(['classic', 'olive', 'silver']);
  const allowedPrivacy = new Set(['everyone', 'contacts-only']);

  if (req.body.theme !== undefined && allowedThemes.has(req.body.theme)) {
    updates.push('theme = ?');
    values.push(req.body.theme);
  }
  if (req.body.privacy_mode !== undefined && allowedPrivacy.has(req.body.privacy_mode)) {
    updates.push('privacy_mode = ?');
    values.push(req.body.privacy_mode);
  }
  if (req.body.sounds_enabled !== undefined) {
    updates.push('sounds_enabled = ?');
    values.push(req.body.sounds_enabled ? 1 : 0);
  }
  if (req.body.allow_friend_requests !== undefined) {
    updates.push('allow_friend_requests = ?');
    values.push(req.body.allow_friend_requests ? 1 : 0);
  }
  if (req.body.allow_file_transfer !== undefined) {
    updates.push('allow_file_transfer = ?');
    values.push(req.body.allow_file_transfer ? 1 : 0);
  }

  if (!updates.length) {
    const settings = await ensureSettings(req.user.userId);
    return res.json({ ok: true, settings });
  }

  updates.push("updated_at = strftime('%s','now')");
  values.push(req.user.userId);
  await db.run(`UPDATE user_settings SET ${updates.join(', ')} WHERE user_id = ?`, values);

  const settings = await ensureSettings(req.user.userId);
  return res.json({ ok: true, settings });
});

module.exports = router;