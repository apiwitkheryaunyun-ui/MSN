const express = require('express');
const router = express.Router();
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const db = require('../db/schema');
const rateLimit = require('../middleware/rateLimit');
const {
  isValidEmail,
  isValidUsername,
  sanitizeDisplayName,
} = require('../validators');

const SALT_ROUNDS = 12;
const JWT_SECRET = process.env.JWT_SECRET || 'dev-only-jwt-secret';
if (process.env.NODE_ENV === 'production' && !process.env.JWT_SECRET) {
  throw new Error('JWT_SECRET is required in production');
}
const COOKIE_OPTS = {
  httpOnly: true,
  sameSite: 'strict',
  maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
  secure: process.env.NODE_ENV === 'production'
};

// Generate unique 10-digit MSN ID
async function generateMsnId() {
  let id;
  let exists = true;
  while (exists) {
    // 1000000000 – 9999999999  (always 10 digits)
    id = String(Math.floor(1000000000 + Math.random() * 9000000000));
    const row = await db.get('SELECT id FROM users WHERE msn_id = ?', [id]);
    exists = !!row;
  }
  return id;
}

// POST /api/auth/register
router.post('/register', rateLimit({ key: 'register', limit: 8, windowMs: 10 * 60_000 }), async (req, res) => {
  try {
    const { username, email, password, display_name } = req.body;

    if (!username || !email || !password) {
      return res.status(400).json({ error: 'กรุณากรอกข้อมูลให้ครบ' });
    }
    if (!isValidUsername(username)) {
      return res.status(400).json({ error: 'Username ใช้ได้เฉพาะ a-z, 0-9, _ และต้อง 3-30 ตัว' });
    }
    if (!isValidEmail(email)) {
      return res.status(400).json({ error: 'รูปแบบอีเมลไม่ถูกต้อง' });
    }
    if (password.length < 8) {
      return res.status(400).json({ error: 'รหัสผ่านต้องมีอย่างน้อย 8 ตัวอักษร' });
    }

    const existingEmail = await db.get('SELECT id FROM users WHERE email = ?', [email.toLowerCase()]);
    if (existingEmail) return res.status(409).json({ error: 'อีเมลนี้ถูกใช้แล้ว' });

    const existingUser = await db.get('SELECT id FROM users WHERE username = ?', [username]);
    if (existingUser) return res.status(409).json({ error: 'Username นี้ถูกใช้แล้ว' });

    const hash = await bcrypt.hash(password, SALT_ROUNDS);
    const msn_id = await generateMsnId();
    const dname = sanitizeDisplayName(display_name || username);

    const info = await db.run(
      'INSERT INTO users (msn_id, username, email, password, display_name) VALUES (?,?,?,?,?)',
      [msn_id, username, email.toLowerCase(), hash, dname]
    );

    const token = jwt.sign({ userId: info.lastID, msn_id }, JWT_SECRET, { expiresIn: '7d' });
    res.cookie('token', token, COOKIE_OPTS);

    return res.status(201).json({
      ok: true,
      user: { id: info.lastID, msn_id, username, display_name: dname }
    });
  } catch (err) {
    console.error('register error', err);
    return res.status(500).json({ error: 'เกิดข้อผิดพลาด กรุณาลองใหม่' });
  }
});

// POST /api/auth/login
router.post('/login', rateLimit({ key: 'login', limit: 15, windowMs: 10 * 60_000 }), async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: 'กรุณากรอกอีเมลและรหัสผ่าน' });
    }

    const user = await db.get(
      'SELECT id, msn_id, username, display_name, password FROM users WHERE email = ?',
      [email.toLowerCase()]
    );

    if (!user) return res.status(401).json({ error: 'อีเมลหรือรหัสผ่านไม่ถูกต้อง' });

    const match = await bcrypt.compare(password, user.password);
    if (!match) return res.status(401).json({ error: 'อีเมลหรือรหัสผ่านไม่ถูกต้อง' });

    const token = jwt.sign({ userId: user.id, msn_id: user.msn_id }, JWT_SECRET, { expiresIn: '7d' });
    res.cookie('token', token, COOKIE_OPTS);

    // Update status to online
    await db.run("UPDATE users SET status='online', last_seen=strftime('%s','now') WHERE id=?", [user.id]);

    return res.json({
      ok: true,
      user: { id: user.id, msn_id: user.msn_id, username: user.username, display_name: user.display_name }
    });
  } catch (err) {
    console.error('login error', err);
    return res.status(500).json({ error: 'เกิดข้อผิดพลาด กรุณาลองใหม่' });
  }
});

// POST /api/auth/logout
router.post('/logout', async (req, res) => {
  const token = req.cookies.token;
  if (token) {
    try {
      const { userId } = jwt.verify(token, JWT_SECRET);
      await db.run("UPDATE users SET status='offline', last_seen=strftime('%s','now') WHERE id=?", [userId]);
    } catch (_) { /* expired token - ignore */ }
  }
  res.clearCookie('token');
  return res.json({ ok: true });
});

// GET /api/auth/me
router.get('/me', async (req, res) => {
  const token = req.cookies.token;
  if (!token) return res.status(401).json({ error: 'ไม่ได้เข้าสู่ระบบ' });
  try {
    const { userId } = jwt.verify(token, JWT_SECRET);
    const user = await db.get(
      'SELECT id, msn_id, username, display_name, status, status_msg, avatar_url FROM users WHERE id=?',
      [userId]
    );
    if (!user) return res.status(401).json({ error: 'ไม่พบผู้ใช้' });
    return res.json({ ok: true, user });
  } catch (_) {
    return res.status(401).json({ error: 'Session หมดอายุ' });
  }
});

module.exports = router;
