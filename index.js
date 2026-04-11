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
const settingsRouter = require('./server/routes/settings');
const configRouter = require('./server/routes/config');
const {
  router: chatRouter,
  getOrCreateConv,
  requireAcceptedFriendship,
  requireConversationMember,
  insertMessage,
  getGroup,
  getGroupMembers,
  mapMessageForDirect,
  mapMessageForGroup,
} = require('./server/routes/chat');

const app = express();
const server = http.createServer(app);

const JWT_SECRET = process.env.JWT_SECRET || 'change_this_in_production';

const io = new Server(server, {
  cors: { origin: false },
  cookie: true
});

app.use(express.json({ limit: '12mb' }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));

app.use('/api/auth', authRouter);
app.use('/api/users', usersRouter);
app.use('/api/friends', friendsRouter);
app.use('/api/settings', settingsRouter);
app.use('/api/config', configRouter);
app.use('/api/chat', chatRouter);

// SPA fallback
app.get('/{*path}', (req, res) => {
  if (req.path.startsWith('/api')) return res.status(404).json({ error: 'Not found' });
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const onlineUsers = new Map();

function emitToUser(userId, eventName, payload, exceptSocketId = null) {
  const sockets = onlineUsers.get(Number(userId));
  if (!sockets) {
    return;
  }

  sockets.forEach((socketId) => {
    if (exceptSocketId && socketId === exceptSocketId) {
      return;
    }
    io.to(socketId).emit(eventName, payload);
  });
}

function emitToMany(userIds, eventName, payload, exceptSocketId = null) {
  Array.from(new Set(userIds.map((value) => Number(value)).filter(Boolean))).forEach((userId) => {
    emitToUser(userId, eventName, payload, exceptSocketId);
  });
}

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

  socket.on('message:send', async (payload, ack) => {
    try {
      const msgType = payload?.msg_type || 'text';
      const content = String(payload?.content || '').trim().slice(0, 4000);

      if (!['text', 'nudge', 'wink', 'file'].includes(msgType)) {
        if (typeof ack === 'function') ack({ ok: false, error: 'ประเภทข้อความไม่ถูกต้อง' });
        return;
      }
      if (msgType !== 'file' && !content) {
        if (typeof ack === 'function') ack({ ok: false, error: 'กรุณากรอกข้อความ' });
        return;
      }

      if (payload?.conversation_id) {
        const conversationId = Number(payload.conversation_id);
        const member = await requireConversationMember(conversationId, uid);
        const group = await getGroup(conversationId);
        if (!member || !group) {
          if (typeof ack === 'function') ack({ ok: false, error: 'ไม่พบกลุ่ม' });
          return;
        }

        const stored = await insertMessage({
          conversationId,
          senderId: uid,
          content,
          msgType,
          attachment: payload.attachment,
        });
        const outbound = mapMessageForGroup(stored, group.title);
        const members = await getGroupMembers(conversationId);
        emitToMany(members.map((memberRow) => memberRow.id), 'message:new', outbound, socket.id);
        if (typeof ack === 'function') ack({ ok: true, message: outbound });
        return;
      }

      const targetUserId = Number(payload?.to_user_id);
      const friendship = await requireAcceptedFriendship(uid, targetUserId);
      if (!friendship) {
        if (typeof ack === 'function') ack({ ok: false, error: 'ต้องเป็นเพื่อนกันก่อนจึงส่งข้อความได้' });
        return;
      }

      const conversationId = await getOrCreateConv(uid, targetUserId);
      const stored = await insertMessage({
        conversationId,
        senderId: uid,
        content,
        msgType,
        attachment: payload.attachment,
      });
      const outbound = mapMessageForDirect(stored, targetUserId);

      emitToUser(targetUserId, 'message:new', outbound);
      emitToUser(uid, 'message:new', outbound, socket.id);
      if (typeof ack === 'function') ack({ ok: true, message: outbound });
    } catch (error) {
      if (typeof ack === 'function') {
        ack({ ok: false, error: error.message || 'ส่งข้อความไม่สำเร็จ' });
      }
    }
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

  socket.on('group:notify', ({ member_ids = [] }) => {
    emitToMany(member_ids, 'group:updated', { by_user_id: uid }, socket.id);
  });

  socket.on('call:invite', async ({ to_user_id, call_id, call_type }) => {
    const friendship = await requireAcceptedFriendship(uid, Number(to_user_id));
    if (!friendship) {
      return;
    }
    emitToUser(to_user_id, 'call:incoming', { from_user_id: uid, call_id, call_type });
  });

  socket.on('call:accept', ({ to_user_id, call_id }) => {
    emitToUser(to_user_id, 'call:accepted', { from_user_id: uid, call_id });
  });

  socket.on('call:reject', ({ to_user_id, call_id }) => {
    emitToUser(to_user_id, 'call:rejected', { from_user_id: uid, call_id });
  });

  socket.on('call:end', ({ to_user_id, call_id }) => {
    emitToUser(to_user_id, 'call:ended', { from_user_id: uid, call_id });
  });

  socket.on('webrtc:offer', ({ to_user_id, call_id, sdp }) => {
    emitToUser(to_user_id, 'webrtc:offer', { from_user_id: uid, call_id, sdp });
  });

  socket.on('webrtc:answer', ({ to_user_id, call_id, sdp }) => {
    emitToUser(to_user_id, 'webrtc:answer', { from_user_id: uid, call_id, sdp });
  });

  socket.on('webrtc:ice-candidate', ({ to_user_id, call_id, candidate }) => {
    emitToUser(to_user_id, 'webrtc:ice-candidate', { from_user_id: uid, call_id, candidate });
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

const PORT = process.env.PORT || 3000;

async function main() {
  await db.init();
  server.listen(PORT, () => console.log(`MSN server running on http://localhost:${PORT}`));
}
main().catch(err => { console.error('Failed to start:', err); process.exit(1); });
