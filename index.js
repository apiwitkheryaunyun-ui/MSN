require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cookieParser = require('cookie-parser');
const jwt = require('jsonwebtoken');
const path = require('path');

const db = require('./server/db/schema');
const authRouter = require('./server/routes/auth');
const usersRouter = require('./server/routes/users');
const friendsRouter = require('./server/routes/friends');
const { router: chatRouter, getOrCreateConv } = require('./server/routes/chat');

const app = express();
const server = http.createServer(app);

const JWT_SECRET = process.env.JWT_SECRET || 'change_this_in_production';

const io = new Server(server, {
  cors: { origin: false },
  cookie: true
});

// 컴 Middleware 컴컴컴컴컴컴컴컴컴컴컴컴컴컴컴컴컴컴컴컴컴컴컴컴
app.use(express.json({ limit: '5mb' }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));

// 컴 API Routes 컴컴컴컴컴컴컴컴컴컴컴컴컴컴컴컴컴컴컴컴컴컴컴컴
app.use('/api/auth', authRouter);
app.use('/api/users', usersRouter);
app.use('/api/friends', friendsRouter);
app.use('/api/chat', chatRouter);

// SPA fallback
app.get('/{*path}', (req, res) => {
  if (req.path.startsWith('/api')) return res.status(404).json({ error: 'Not found' });
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// 컴 Socket.io 컴컴컴컴컴컴컴컴컴컴컴컴컴컴컴컴컴컴컴컴컴컴컴컴�
const onlineUsers = new Map();

io.use((socket, next) => {
  const token = socket.handshake.auth.token ||
    (socket.request.headers.cookie || '')
      .split(';').map(c => c.trim())
      .find(c => c.startsWith('token='))?.split('=')[1];
  if (!token) return next(new Error('auth'));
  try {
    socket.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    next(new Error('auth'));
  }
});

io.on('connection', async (socket) => {
  const uid = socket.user.userId;

  if (!onlineUsers.has(uid)) onlineUsers.set(uid, new Set());
  onlineUsers.get(uid).add(socket.id);

  await db.run(
    "UPDATE users SET status='online', last_seen=strftime('%s','now') WHERE id=?",
    [uid]
  );
  broadcastStatusToFriends(uid, 'online');

  socket.on('disconnect', async () => {
    const sockets = onlineUsers.get(uid);
    if (sockets) {
      sockets.delete(socket.id);
      if (sockets.size === 0) {
        onlineUsers.delete(uid);
        await db.run(
          "UPDATE users SET status='offline', last_seen=strftime('%s','now') WHERE id=?",
          [uid]
        );
        broadcastStatusToFriends(uid, 'offline');
      }
    }
  });

  socket.on('status:set', async ({ status }) => {
    const valid = ['online', 'away', 'busy', 'be right back', 'appear offline'];
    if (!valid.includes(status)) return;
    await db.run('UPDATE users SET status=? WHERE id=?', [status, uid]);
    broadcastStatusToFriends(uid, status);
  });

  socket.on('message:send', async ({ to_user_id, content, msg_type = 'text' }, ack) => {
    if (!content || !String(content).trim()) return;
    if (!['text', 'nudge', 'wink'].includes(msg_type)) return;

    const friendship = await db.get(
      "SELECT id FROM friends WHERE status='accepted' AND ((user_id=? AND friend_id=?) OR (user_id=? AND friend_id=?))",
      [uid, to_user_id, to_user_id, uid]
    );
    if (!friendship) return;

    const convId = await getOrCreateConv(uid, to_user_id);
    const safe = String(content).slice(0, 4000);

    const msg = await db.run(
      'INSERT INTO messages (conversation_id, sender_id, content, msg_type) VALUES (?,?,?,?)',
      [convId, uid, safe, msg_type]
    );

    const sender = await db.get('SELECT display_name, avatar_url FROM users WHERE id=?', [uid]);
    const payload = {
      id: msg.lastID,
      conversation_id: convId,
      sender_id: uid,
      sender_name: sender.display_name,
      sender_avatar: sender.avatar_url,
      content: safe,
      msg_type,
      sent_at: Math.floor(Date.now() / 1000),
      is_read: 0
    };

    const recipientSockets = onlineUsers.get(to_user_id);
    if (recipientSockets) {
      recipientSockets.forEach(sid => io.to(sid).emit('message:new', payload));
    }

    const senderSockets = onlineUsers.get(uid);
    if (senderSockets) {
      senderSockets.forEach(sid => {
        if (sid !== socket.id) io.to(sid).emit('message:new', payload);
      });
    }

    if (typeof ack === 'function') ack({ ok: true, message: payload });
  });

  socket.on('typing:start', async ({ to_user_id }) => {
    const sockets = onlineUsers.get(to_user_id);
    if (sockets) {
      const sender = await db.get('SELECT display_name FROM users WHERE id=?', [uid]);
      sockets.forEach(sid => io.to(sid).emit('typing:start', { from_user_id: uid, name: sender?.display_name }));
    }
  });

  socket.on('typing:stop', ({ to_user_id }) => {
    const sockets = onlineUsers.get(to_user_id);
    if (sockets) {
      sockets.forEach(sid => io.to(sid).emit('typing:stop', { from_user_id: uid }));
    }
  });

  socket.on('friend:request_sent', async ({ to_user_id }) => {
    const sockets = onlineUsers.get(to_user_id);
    if (sockets) {
      const sender = await db.get('SELECT msn_id, display_name, username FROM users WHERE id=?', [uid]);
      sockets.forEach(sid => io.to(sid).emit('friend:request_received', sender));
    }
  });
});

async function broadcastStatusToFriends(userId, status) {
  const friends = await db.all(`
    SELECT CASE WHEN user_id=? THEN friend_id ELSE user_id END AS fid
    FROM friends WHERE (user_id=? OR friend_id=?) AND status='accepted'
  `, [userId, userId, userId]);

  friends.forEach(({ fid }) => {
    const sockets = onlineUsers.get(fid);
    if (sockets) {
      sockets.forEach(sid => io.to(sid).emit('status:changed', { user_id: userId, status }));
    }
  });
}

// 컴 Start 컴컴컴컴컴컴컴컴컴컴컴컴컴컴컴컴컴컴컴컴컴컴컴컴컴컴�
const PORT = process.env.PORT || 3000;

async function main() {
  await db.init();
  server.listen(PORT, () => console.log(`MSN server running on http://localhost:${PORT}`));
}
main().catch(err => { console.error('Failed to start:', err); process.exit(1); });
