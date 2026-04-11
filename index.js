require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cookieParser = require('cookie-parser');
const jwt = require('jsonwebtoken');
const path = require('path');
const fs = require('fs');

const db = require('./server/db/schema');
const authRouter = require('./server/routes/auth');
const usersRouter = require('./server/routes/users');
const friendsRouter = require('./server/routes/friends');
const settingsRouter = require('./server/routes/settings');
const { router: chatRouter, getOrCreateConv } = require('./server/routes/chat');
const {
  getConversationById,
  ensureAcceptedFriendship,
  ensureConversationMember,
  getConversationRecipients,
  createMessage,
} = require('./server/services/chatService');
const { isValidMessageType, sanitizeText, validateAttachment } = require('./server/validators');

const app = express();
const server = http.createServer(app);

const JWT_SECRET = process.env.JWT_SECRET || 'change_this_in_production';

const io = new Server(server, {
  cors: { origin: false },
  cookie: true
});

// �� Middleware ������������������������������������������������
app.use(express.json({ limit: '5mb' }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));

const uploadsDir = process.env.LOCAL_STORAGE_PATH || path.join(__dirname, 'data/uploads');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });
app.use('/uploads', express.static(uploadsDir));

// �� API Routes ������������������������������������������������
app.use('/api/auth', authRouter);
app.use('/api/users', usersRouter);
app.use('/api/friends', friendsRouter);
app.use('/api/settings', settingsRouter);
app.use('/api/chat', chatRouter);

app.get('/api/config/webrtc', (req, res) => {
  const stunUrls = (process.env.WEBRTC_STUN_URLS || 'stun:stun.l.google.com:19302')
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean);
  const turnUrls = (process.env.WEBRTC_TURN_URLS || '')
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean);

  const iceServers = [{ urls: stunUrls }];
  if (turnUrls.length && process.env.WEBRTC_TURN_USERNAME && process.env.WEBRTC_TURN_CREDENTIAL) {
    iceServers.push({
      urls: turnUrls,
      username: process.env.WEBRTC_TURN_USERNAME,
      credential: process.env.WEBRTC_TURN_CREDENTIAL,
    });
  }

  return res.json({ ok: true, webrtc: { iceServers } });
});

// SPA fallback
app.get('/{*path}', (req, res) => {
  if (req.path.startsWith('/api')) return res.status(404).json({ error: 'Not found' });
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// �� Socket.io �������������������������������������������������
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

  socket.on('message:send', async (payload, ack) => {
    try {
      const msgType = payload?.msg_type || 'text';
      if (!isValidMessageType(msgType)) return;

      const attachmentCheck = validateAttachment(payload?.attachment);
      if (!attachmentCheck.ok) {
        if (typeof ack === 'function') ack({ ok: false, error: attachmentCheck.error });
        return;
      }

      let convId;
      let recipients = [];
      let conversationKind = 'direct';
      let conversationTitle = '';

      if (payload?.conversation_id) {
        const conversationId = parseInt(payload.conversation_id, 10);
        const conv = await getConversationById(conversationId);
        if (!conv || conv.kind !== 'group') {
          if (typeof ack === 'function') ack({ ok: false, error: 'ไม่พบห้องแชตกลุ่ม' });
          return;
        }
        const member = await ensureConversationMember(conversationId, uid);
        if (!member) {
          if (typeof ack === 'function') ack({ ok: false, error: 'ไม่มีสิทธิ์ในห้องนี้' });
          return;
        }

        convId = conversationId;
        conversationKind = 'group';
        conversationTitle = conv.title;
        recipients = (await getConversationRecipients(convId, uid)).map(row => row.user_id);
      } else {
        const targetUserId = parseInt(payload?.to_user_id, 10);
        const friendship = await ensureAcceptedFriendship(uid, targetUserId);
        if (!friendship) {
          if (typeof ack === 'function') ack({ ok: false, error: 'ต้องเป็นเพื่อนกันก่อนจึงส่งข้อความได้' });
          return;
        }
        convId = await getOrCreateConv(uid, targetUserId);
        recipients = [targetUserId];
      }

      const inserted = await createMessage({
        conversationId: convId,
        senderId: uid,
        content: sanitizeText(payload?.content, msgType === 'file' ? 280 : 4000),
        msgType,
        attachment: attachmentCheck.attachment,
      });

      const sender = await db.get('SELECT display_name, avatar_url, username FROM users WHERE id=?', [uid]);
      const messagePayload = {
        ...inserted,
        sender_name: sender.display_name,
        sender_avatar: sender.avatar_url,
        conversation_id: convId,
        conversation_kind: conversationKind,
        conversation_title: conversationTitle,
        peer_user_id: payload?.to_user_id || null,
      };

      recipients.forEach((recipientId) => {
        const recipientSockets = onlineUsers.get(recipientId);
        if (recipientSockets) {
          recipientSockets.forEach((sid) => io.to(sid).emit('message:new', messagePayload));
        }
      });

      if (conversationKind === 'group') {
        recipients.forEach((recipientId) => {
          const recipientSockets = onlineUsers.get(recipientId);
          if (recipientSockets) {
            recipientSockets.forEach((sid) => io.to(sid).emit('group:updated', { conversation_id: convId }));
          }
        });
      }

      const senderSockets = onlineUsers.get(uid);
      if (senderSockets) {
        senderSockets.forEach((sid) => {
          if (sid !== socket.id) io.to(sid).emit('message:new', messagePayload);
        });
      }

      if (typeof ack === 'function') ack({ ok: true, message: messagePayload });
    } catch (error) {
      console.error('socket message error', error);
      if (typeof ack === 'function') ack({ ok: false, error: 'ส่งข้อความไม่สำเร็จ' });
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

  socket.on('group:notify', ({ conversation_id, member_ids = [], type = 'updated' }) => {
    const targets = [...new Set((member_ids || []).map(Number).filter(Boolean))];
    targets.forEach((targetId) => {
      const sockets = onlineUsers.get(targetId);
      if (sockets) {
        sockets.forEach((sid) => io.to(sid).emit('group:updated', { conversation_id, type }));
      }
    });
  });

  socket.on('call:invite', ({ to_user_id, call_id, call_type = 'voice', conversation_id }) => {
    const recipientSockets = onlineUsers.get(Number(to_user_id));
    if (!recipientSockets) return;
    recipientSockets.forEach((sid) => io.to(sid).emit('call:incoming', {
      from_user_id: uid,
      call_id,
      call_type,
      conversation_id: conversation_id || null,
    }));
  });

  socket.on('call:accept', ({ to_user_id, call_id }) => {
    const recipientSockets = onlineUsers.get(Number(to_user_id));
    if (!recipientSockets) return;
    recipientSockets.forEach((sid) => io.to(sid).emit('call:accepted', { from_user_id: uid, call_id }));
  });

  socket.on('call:reject', ({ to_user_id, call_id }) => {
    const recipientSockets = onlineUsers.get(Number(to_user_id));
    if (!recipientSockets) return;
    recipientSockets.forEach((sid) => io.to(sid).emit('call:rejected', { from_user_id: uid, call_id }));
  });

  socket.on('call:end', ({ to_user_id, call_id }) => {
    const recipientSockets = onlineUsers.get(Number(to_user_id));
    if (!recipientSockets) return;
    recipientSockets.forEach((sid) => io.to(sid).emit('call:ended', { from_user_id: uid, call_id }));
  });

  socket.on('webrtc:offer', ({ to_user_id, call_id, sdp }) => {
    const recipientSockets = onlineUsers.get(Number(to_user_id));
    if (!recipientSockets) return;
    recipientSockets.forEach((sid) => io.to(sid).emit('webrtc:offer', { from_user_id: uid, call_id, sdp }));
  });

  socket.on('webrtc:answer', ({ to_user_id, call_id, sdp }) => {
    const recipientSockets = onlineUsers.get(Number(to_user_id));
    if (!recipientSockets) return;
    recipientSockets.forEach((sid) => io.to(sid).emit('webrtc:answer', { from_user_id: uid, call_id, sdp }));
  });

  socket.on('webrtc:ice-candidate', ({ to_user_id, call_id, candidate }) => {
    const recipientSockets = onlineUsers.get(Number(to_user_id));
    if (!recipientSockets) return;
    recipientSockets.forEach((sid) => io.to(sid).emit('webrtc:ice-candidate', { from_user_id: uid, call_id, candidate }));
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

// �� Start �����������������������������������������������������
const PORT = process.env.PORT || 3000;

async function main() {
  await db.init();
  server.listen(PORT, () => console.log(`MSN server running on http://localhost:${PORT}`));
}
main().catch(err => { console.error('Failed to start:', err); process.exit(1); });
