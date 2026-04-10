/* ══════════════════════════════════════════════════════
   MSN Messenger — Client-side JavaScript
   All API calls use relative paths (no external URLs)
══════════════════════════════════════════════════════ */
'use strict';

// ── State ────────────────────────────────────────────
let me = null;           // current user object
let socket = null;       // Socket.io connection
let friends = [];        // friend list cache
let chatWindows = {};    // userId → DOM element

const TYPING_DEBOUNCE = 1500; // ms
let typingTimers = {};   // userId → timeout id

// ── DOM refs ─────────────────────────────────────────
const authScreen      = document.getElementById('auth-screen');
const app             = document.getElementById('app');
const loginPanel      = document.getElementById('login-panel');
const registerPanel   = document.getElementById('register-panel');

// ── Utility ──────────────────────────────────────────
const $ = id => document.getElementById(id);
const fmtTime = ts => {
  const d = new Date(ts * 1000);
  return d.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' });
};

function toast(msg, duration = 3500) {
  const el = $('notification-toast');
  el.textContent = msg;
  el.classList.remove('hidden');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => el.classList.add('hidden'), duration);
}

function statusClass(s) {
  if (!s || s === 'appear offline') return 'offline';
  return s.replace(/\s+/g, '-').toLowerCase();
}

async function api(method, path, body) {
  const opts = { method, headers: { 'Content-Type': 'application/json' } };
  if (body) opts.body = JSON.stringify(body);
  const r = await fetch(path, opts);
  return r.json();
}

// ── Auth ─────────────────────────────────────────────
$('goto-register').onclick = () => {
  loginPanel.classList.remove('active');
  registerPanel.classList.add('active');
};
$('goto-login').onclick = () => {
  registerPanel.classList.remove('active');
  loginPanel.classList.add('active');
};

$('login-btn').onclick = async () => {
  const email    = $('login-email').value.trim();
  const password = $('login-password').value;
  $('login-error').textContent = '';
  const data = await api('POST', '/api/auth/login', { email, password });
  if (!data.ok) { $('login-error').textContent = data.error; return; }
  me = data.user;
  startApp();
};

$('login-password').addEventListener('keydown', e => {
  if (e.key === 'Enter') $('login-btn').click();
});

$('register-btn').onclick = async () => {
  const username     = $('reg-username').value.trim();
  const display_name = $('reg-display').value.trim();
  const email        = $('reg-email').value.trim();
  const password     = $('reg-password').value;
  $('register-error').textContent = '';
  const data = await api('POST', '/api/auth/register', { username, display_name, email, password });
  if (!data.ok) { $('register-error').textContent = data.error; return; }
  me = data.user;
  startApp();
};

$('app-logout').onclick = async () => {
  await api('POST', '/api/auth/logout');
  location.reload();
};

// ── Startup ──────────────────────────────────────────
async function init() {
  const data = await api('GET', '/api/auth/me');
  if (data.ok) { me = data.user; startApp(); }
}

async function startApp() {
  authScreen.classList.add('hidden');
  app.classList.remove('hidden');
  renderMyProfile();
  await loadFriends();
  await loadPendingRequests();
  connectSocket();
  setInterval(loadPendingRequests, 30000);
}

function renderMyProfile() {
  $('my-display-name').textContent = me.display_name || me.username;
  $('my-status-msg').textContent   = me.status_msg || '';
  $('my-msn-id').textContent       = me.msn_id;
  if (me.avatar_url) $('my-avatar').src = me.avatar_url;
  $('status-select').value = me.status || 'online';
}

// ── My profile edits ─────────────────────────────────
let profileSaveTimer;
function scheduleProfileSave() {
  clearTimeout(profileSaveTimer);
  profileSaveTimer = setTimeout(async () => {
    const display_name = $('my-display-name').textContent.trim().slice(0, 50);
    const status_msg   = $('my-status-msg').textContent.trim().slice(0, 140);
    await api('PATCH', '/api/users/me', { display_name, status_msg });
    if (socket) socket.emit('status:set', { status: $('status-select').value });
  }, 1200);
}

$('my-display-name').addEventListener('input', scheduleProfileSave);
$('my-status-msg').addEventListener('input', scheduleProfileSave);

$('status-select').onchange = async () => {
  const status = $('status-select').value;
  await api('PATCH', '/api/users/me', { status });
  if (socket) socket.emit('status:set', { status });
};

// Avatar upload (convert to base64 data URL stored on server)
$('avatar-input').onchange = async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  if (file.size > 2 * 1024 * 1024) { toast('รูปใหญ่เกิน 2MB ครับ'); return; }
  const reader = new FileReader();
  reader.onload = async () => {
    const avatar_url = reader.result;
    $('my-avatar').src = avatar_url;
    await api('PATCH', '/api/users/me', { avatar_url });
    me.avatar_url = avatar_url;
  };
  reader.readAsDataURL(file);
};

$('copy-id-btn').onclick = () => {
  navigator.clipboard.writeText(me.msn_id).then(() => toast('คัดลอก MSN ID แล้ว!'));
};

// ── Friends ──────────────────────────────────────────
async function loadFriends() {
  const data = await api('GET', '/api/friends');
  if (!data.ok) return;
  friends = data.friends;
  renderFriends();
}

function renderFriends() {
  const onlineEl  = $('online-list');
  const offlineEl = $('offline-list');
  onlineEl.innerHTML  = '';
  offlineEl.innerHTML = '';

  friends.forEach(f => {
    const el = createContactItem(f);
    if (f.status === 'online' || f.status === 'away' || f.status === 'busy' || f.status === 'be right back') {
      onlineEl.appendChild(el);
    } else {
      offlineEl.appendChild(el);
    }
  });
}

function createContactItem(f) {
  const div = document.createElement('div');
  div.className = 'contact-item';
  div.dataset.userId = f.id;

  const dot = document.createElement('span');
  dot.className = `status-dot ${statusClass(f.status)}`;

  const avatar = document.createElement('img');
  avatar.className = 'contact-avatar';
  avatar.src = f.avatar_url || 'img/default-avatar.png';
  avatar.alt = '';

  const info = document.createElement('div');
  info.className = 'contact-info';
  info.innerHTML = `
    <div class="contact-name">${escHtml(f.display_name || f.username)}</div>
    <div class="contact-status-msg">${escHtml(f.status_msg || f.msn_id)}</div>
  `;

  div.appendChild(dot);
  div.appendChild(avatar);
  div.appendChild(info);
  div.addEventListener('click', () => openChat(f));
  return div;
}

// Add contact
$('add-contact-btn').onclick = addContact;
$('add-contact-input').addEventListener('keydown', e => {
  if (e.key === 'Enter') addContact();
});

async function addContact() {
  const msn_id = $('add-contact-input').value.trim();
  if (!/^\d{10}$/.test(msn_id)) { toast('MSN ID ต้องเป็นตัวเลข 10 หลัก'); return; }
  const data = await api('POST', '/api/friends/add', { msn_id });
  if (!data.ok) { toast(data.error); return; }
  toast('ส่งคำขอเป็นเพื่อนแล้ว! 🎉');
  $('add-contact-input').value = '';
  if (socket) {
    // Notify target if online
    const userRes = await api('GET', `/api/users/search?msn_id=${msn_id}`);
    if (userRes.ok) socket.emit('friend:request_sent', { to_user_id: userRes.user.id });
  }
}

// Pending requests
async function loadPendingRequests() {
  const data = await api('GET', '/api/friends/requests');
  if (!data.ok) return;
  const section = $('requests-section');
  const list    = $('requests-list');
  list.innerHTML = '';

  if (!data.requests.length) {
    section.classList.add('hidden');
    return;
  }
  section.classList.remove('hidden');

  data.requests.forEach(r => {
    const div = document.createElement('div');
    div.className = 'request-item';
    div.innerHTML = `
      <img src="${r.avatar_url || 'img/default-avatar.png'}" class="contact-avatar" style="width:24px;height:24px" alt="">
      <span class="req-name">${escHtml(r.display_name || r.username)}<br><small>${r.msn_id}</small></span>
      <button class="req-accept" data-id="${r.req_id}">✓</button>
      <button class="req-reject" data-id="${r.req_id}">✕</button>
    `;
    list.appendChild(div);
  });

  list.querySelectorAll('.req-accept').forEach(btn => {
    btn.onclick = async () => {
      await api('POST', `/api/friends/accept/${btn.dataset.id}`);
      await loadFriends();
      await loadPendingRequests();
      toast('ตอบรับคำขอเป็นเพื่อนแล้ว 🤝');
    };
  });
  list.querySelectorAll('.req-reject').forEach(btn => {
    btn.onclick = async () => {
      await api('POST', `/api/friends/reject/${btn.dataset.id}`);
      await loadPendingRequests();
    };
  });
}

// ── Chat ─────────────────────────────────────────────
async function openChat(friend) {
  if (chatWindows[friend.id]) {
    chatWindows[friend.id].querySelector('.chat-input').focus();
    return;
  }

  const tpl = document.getElementById('chat-window-tpl');
  const win = tpl.content.cloneNode(true).querySelector('.chat-window');
  win.dataset.convUser = friend.id;

  // Fill header
  win.querySelector('.chat-partner-name').textContent     = friend.display_name || friend.username;
  win.querySelector('.chat-partner-display').textContent  = friend.display_name || friend.username;
  win.querySelector('.chat-partner-status').textContent   = friend.status || 'offline';
  if (friend.avatar_url) win.querySelector('.chat-partner-avatar').src = friend.avatar_url;

  // Position offset
  const offset = Object.keys(chatWindows).length * 28;
  win.style.top  = `${60 + offset}px`;
  win.style.left = `${320 + offset}px`;

  // Close
  win.querySelector('.chat-close').onclick = () => {
    win.remove();
    delete chatWindows[friend.id];
  };

  // Send
  const input  = win.querySelector('.chat-input');
  const sendBtn = win.querySelector('.send-btn');

  sendBtn.onclick = () => sendMessage(friend, win, input);
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage(friend, win, input);
    }
  });

  // Typing indicator
  input.addEventListener('input', () => {
    if (socket) socket.emit('typing:start', { to_user_id: friend.id });
    clearTimeout(typingTimers[friend.id]);
    typingTimers[friend.id] = setTimeout(() => {
      if (socket) socket.emit('typing:stop', { to_user_id: friend.id });
    }, TYPING_DEBOUNCE);
  });

  // Nudge / Wink
  win.querySelector('.nudge-btn').onclick = () => sendMessage(friend, win, null, 'nudge', '💥 Nudge!');
  win.querySelector('.wink-btn').onclick  = () => sendMessage(friend, win, null, 'wink', '😜 Wink~');

  document.getElementById('chat-windows').appendChild(win);
  chatWindows[friend.id] = win;

  makeDraggable(win, win.querySelector('.chat-titlebar'));

  // Load history
  const data = await api('GET', `/api/chat/${friend.id}/messages`);
  if (data.ok) {
    data.messages.forEach(m => appendMessage(win, m, friend));
  }

  const msgs = win.querySelector('.chat-messages');
  msgs.scrollTop = msgs.scrollHeight;
  input.focus();
}

async function sendMessage(friend, win, inputEl, type = 'text', preset = null) {
  const content = preset ?? (inputEl ? inputEl.value.trim() : '');
  if (!content) return;

  new Promise(resolve => {
    if (socket && socket.connected) {
      socket.emit('message:send', { to_user_id: friend.id, content, msg_type: type }, (ack) => {
        if (ack?.ok) resolve(ack.message);
        else resolve(null);
      });
    } else {
      api('POST', `/api/chat/${friend.id}/send`, { content, msg_type: type }).then(r => resolve(r.ok ? r.message : null));
    }
  }).then(msg => {
    if (msg) {
      appendMessage(win, { ...msg, sender_id: me.id }, friend);
      const msgs = win.querySelector('.chat-messages');
      msgs.scrollTop = msgs.scrollHeight;
    }
  });

  if (inputEl) inputEl.value = '';
}

function appendMessage(win, msg, friend) {
  const msgs  = win.querySelector('.chat-messages');
  const isMine = msg.sender_id === me.id;

  const row = document.createElement('div');
  row.className = `msg-row ${isMine ? 'mine' : 'theirs'}`;

  const senderName = isMine ? (me.display_name || me.username) : (friend.display_name || friend.username);

  row.innerHTML = `
    <div class="msg-sender">${escHtml(senderName)}</div>
    <div class="msg-bubble ${msg.msg_type !== 'text' ? escHtml(msg.msg_type) : ''}">${escHtml(msg.content)}</div>
    <div class="msg-time">${fmtTime(msg.sent_at)}</div>
  `;

  msgs.appendChild(row);
}

// ── Socket.io ─────────────────────────────────────────
function connectSocket() {
  socket = io({ auth: { token: '' }, withCredentials: true });

  socket.on('connect_error', () => {
    // Cookie-based auth; no action needed
  });

  socket.on('message:new', (msg) => {
    const fromId = msg.sender_id;
    if (!chatWindows[fromId]) {
      // Find friend object
      const f = friends.find(fr => fr.id === fromId);
      if (f) {
        openChat(f).then(() => {
          const win = chatWindows[fromId];
          if (win) {
            appendMessage(win, msg, f);
            win.querySelector('.chat-messages').scrollTop = 9999;
          }
        });
        toast(`💬 ข้อความใหม่จาก ${f.display_name || f.username}`);
      }
    } else {
      const win = chatWindows[fromId];
      const f   = friends.find(fr => fr.id === fromId) || { display_name: msg.sender_name };
      appendMessage(win, msg, f);
      win.querySelector('.chat-messages').scrollTop = 9999;
    }
  });

  socket.on('typing:start', ({ from_user_id, name }) => {
    const win = chatWindows[from_user_id];
    if (!win) return;
    const el = win.querySelector('.typing-indicator');
    el.querySelector('#typing-text').textContent = `${name} กำลังพิมพ์...`;
    el.classList.remove('hidden');
  });

  socket.on('typing:stop', ({ from_user_id }) => {
    const win = chatWindows[from_user_id];
    if (!win) return;
    win.querySelector('.typing-indicator').classList.add('hidden');
  });

  socket.on('status:changed', ({ user_id, status }) => {
    const f = friends.find(fr => fr.id === user_id);
    if (f) {
      f.status = status;
      renderFriends();
      // Update open chat window header
      const win = chatWindows[user_id];
      if (win) win.querySelector('.chat-partner-status').textContent = status;
    }
  });

  socket.on('friend:request_received', (sender) => {
    toast(`👤 ${sender.display_name || sender.username} ขอเป็นเพื่อน! (${sender.msn_id})`);
    loadPendingRequests();
  });
}

// ── Drag ─────────────────────────────────────────────
function makeDraggable(win, handle) {
  let ox = 0, oy = 0;
  handle.addEventListener('pointerdown', e => {
    e.preventDefault();
    const rect = win.getBoundingClientRect();
    ox = e.clientX - rect.left;
    oy = e.clientY - rect.top;
    win.style.zIndex = 300;

    function onMove(e) {
      win.style.left = `${Math.max(0, e.clientX - ox)}px`;
      win.style.top  = `${Math.max(0, e.clientY - oy)}px`;
    }
    function onUp() {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    }
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  });
}

// Make buddy window draggable
makeDraggable($('buddy-window'), $('buddy-window').querySelector('.msn-titlebar'));

// ── Security: escape HTML ─────────────────────────────
function escHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;');
}

// ── Boot ─────────────────────────────────────────────
init();
