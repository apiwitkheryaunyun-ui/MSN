/* ══════════════════════════════════════════════════════
   MSN Messenger — Client-side JavaScript
══════════════════════════════════════════════════════ */
'use strict';

let me = null;
let socket = null;
let friends = [];
let groups = [];
let settings = {
  theme: 'classic',
  sounds_enabled: 1,
  allow_friend_requests: 1,
  allow_file_transfer: 1,
  privacy_mode: 'everyone',
};
let chatWindows = {};
let typingTimers = {};
let webrtcConfig = { iceServers: [{ urls: ['stun:stun.l.google.com:19302'] }] };
let activeCalls = new Map();
const isEmbeddedMode = window.self !== window.top;

const TYPING_DEBOUNCE = 1500;
const MAX_FILE_BYTES = 10 * 1024 * 1024;
const MAX_AVATAR_EXPORT_BYTES = 320 * 1024;
const AVATAR_CANVAS_SIZE = 180;
const OPEN_CONVERSATIONS_KEY = 'msn-open-conversations';
const $ = (id) => document.getElementById(id);
const authScreen = $('auth-screen');
const app = $('app');
const loginPanel = $('login-panel');
const registerPanel = $('register-panel');

const directKey = (userId) => `direct:${userId}`;
const groupKey = (conversationId) => `group:${conversationId}`;

function fmtTime(ts) {
  const d = new Date(ts * 1000);
  return d.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' });
}

function toast(msg, duration = 3500) {
  const el = $('notification-toast');
  el.textContent = msg;
  el.classList.remove('hidden');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => el.classList.add('hidden'), duration);
}

function statusClass(status) {
  if (!status || status === 'appear offline') return 'offline';
  return status.replace(/\s+/g, '-').toLowerCase();
}

function escHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;');
}

async function api(method, path, body) {
  const opts = { method, headers: { 'Content-Type': 'application/json' } };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(path, opts);
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    return { ok: false, error: text || `Request failed: ${res.status}` };
  }
}

function estimateDataUrlBytes(dataUrl) {
  const base64 = String(dataUrl).split(',')[1] || '';
  const padding = base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0;
  return Math.max(0, Math.floor((base64.length * 3) / 4) - padding);
}

function loadImageFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('อ่านรูปภาพไม่สำเร็จ'));
    reader.onload = () => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error('ไฟล์รูปภาพไม่ถูกต้อง'));
      image.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

async function buildAvatarDataUrl(file) {
  if (!file.type.startsWith('image/')) {
    throw new Error('อัปโหลดได้เฉพาะไฟล์รูปภาพ');
  }

  const image = await loadImageFile(file);
  const canvas = document.createElement('canvas');
  canvas.width = AVATAR_CANVAS_SIZE;
  canvas.height = AVATAR_CANVAS_SIZE;
  const context = canvas.getContext('2d');

  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, canvas.width, canvas.height);

  const ratio = Math.min(canvas.width / image.width, canvas.height / image.height);
  const drawWidth = image.width * ratio;
  const drawHeight = image.height * ratio;
  const offsetX = (canvas.width - drawWidth) / 2;
  const offsetY = (canvas.height - drawHeight) / 2;

  context.drawImage(image, offsetX, offsetY, drawWidth, drawHeight);

  let quality = 0.92;
  let dataUrl = canvas.toDataURL('image/jpeg', quality);
  while (estimateDataUrlBytes(dataUrl) > MAX_AVATAR_EXPORT_BYTES && quality > 0.45) {
    quality -= 0.08;
    dataUrl = canvas.toDataURL('image/jpeg', quality);
  }

  return dataUrl;
}

function readOpenConversationState() {
  try {
    return JSON.parse(localStorage.getItem(OPEN_CONVERSATIONS_KEY) || '[]');
  } catch {
    return [];
  }
}

function writeOpenConversationState(entries) {
  localStorage.setItem(OPEN_CONVERSATIONS_KEY, JSON.stringify(entries.slice(0, 6)));
}

function rememberOpenConversation(meta) {
  const entries = readOpenConversationState().filter((entry) => entry.key !== meta.key);
  entries.unshift({ key: meta.key, kind: meta.kind, targetId: meta.targetId });
  writeOpenConversationState(entries);
}

function forgetOpenConversation(chatKey) {
  writeOpenConversationState(readOpenConversationState().filter((entry) => entry.key !== chatKey));
}

async function restoreOpenConversations() {
  const entries = readOpenConversationState();
  for (const entry of entries) {
    if (entry.kind === 'direct') {
      const friend = friends.find((item) => Number(item.id) === Number(entry.targetId));
      if (friend) {
        await openDirectChat(friend);
      }
      continue;
    }

    if (entry.kind === 'group') {
      const group = groups.find((item) => Number(item.id) === Number(entry.targetId));
      if (group) {
        await openGroupChat(group);
      }
    }
  }
}

function applyTheme() {
  document.body.dataset.theme = settings.theme || 'classic';
}

function setProfileFields() {
  $('my-display-name').textContent = me.display_name || me.username;
  $('my-status-msg').textContent = me.status_msg || '';
  $('my-msn-id').textContent = me.msn_id;
  $('status-select').value = me.status || 'online';
  $('my-avatar').src = me.avatar_url || 'img/default-avatar.png';
}

function renderSettings() {
  $('theme-select').value = settings.theme || 'classic';
  $('privacy-select').value = settings.privacy_mode || 'everyone';
  $('sounds-toggle').checked = !!settings.sounds_enabled;
  $('friend-requests-toggle').checked = !!settings.allow_friend_requests;
  $('file-transfer-toggle').checked = !!settings.allow_file_transfer;
  applyTheme();
}

async function loadSettings() {
  const data = await api('GET', '/api/settings/me');
  if (data.ok) {
    settings = { ...settings, ...data.settings };
    renderSettings();
  }
}

async function loadWebrtcConfig() {
  const data = await api('GET', '/api/config/webrtc');
  if (data.ok && data.webrtc) {
    webrtcConfig = data.webrtc;
  }
}

async function saveSettings(patch) {
  const data = await api('PATCH', '/api/settings/me', patch);
  if (!data.ok) {
    toast(data.error || 'อัปเดตการตั้งค่าไม่สำเร็จ');
    return;
  }
  settings = { ...settings, ...data.settings };
  renderSettings();
}

async function init() {
  const data = await api('GET', '/api/auth/me');
  if (data.ok) {
    me = data.user;
    startApp();
  }
}

async function startApp() {
  authScreen.classList.add('hidden');
  app.classList.remove('hidden');
  if (isEmbeddedMode) {
    document.body.classList.add('embedded-msn');
    app.classList.add('embedded-msn-app');
  }
  setProfileFields();
  await Promise.all([loadSettings(), loadWebrtcConfig(), loadFriends(), loadGroups(), loadPendingRequests()]);
  connectSocket();
  await restoreOpenConversations();
  setInterval(loadPendingRequests, 30000);
  setInterval(loadGroups, 45000);
}

function activateEmbeddedChat(targetWin) {
  if (!isEmbeddedMode) return;
  const chatContainer = $('chat-windows');
  const windows = chatContainer.querySelectorAll('.chat-window');
  windows.forEach((win) => win.classList.toggle('hidden', win !== targetWin));
}

$('goto-register').onclick = () => {
  loginPanel.classList.remove('active');
  registerPanel.classList.add('active');
};

$('goto-login').onclick = () => {
  registerPanel.classList.remove('active');
  loginPanel.classList.add('active');
};

$('login-btn').onclick = async () => {
  const data = await api('POST', '/api/auth/login', {
    email: $('login-email').value.trim(),
    password: $('login-password').value,
  });
  $('login-error').textContent = data.ok ? '' : data.error;
  if (!data.ok) return;
  me = data.user;
  startApp();
};

$('login-password').addEventListener('keydown', (event) => {
  if (event.key === 'Enter') $('login-btn').click();
});

$('register-btn').onclick = async () => {
  const data = await api('POST', '/api/auth/register', {
    username: $('reg-username').value.trim(),
    display_name: $('reg-display').value.trim(),
    email: $('reg-email').value.trim(),
    password: $('reg-password').value,
  });
  $('register-error').textContent = data.ok ? '' : data.error;
  if (!data.ok) return;
  me = data.user;
  startApp();
};

$('app-logout').onclick = async () => {
  await api('POST', '/api/auth/logout');
  location.reload();
};

let profileSaveTimer;
function scheduleProfileSave() {
  clearTimeout(profileSaveTimer);
  profileSaveTimer = setTimeout(async () => {
    const data = await api('PATCH', '/api/users/me', {
      display_name: $('my-display-name').textContent.trim().slice(0, 50),
      status_msg: $('my-status-msg').textContent.trim().slice(0, 140),
    });
    if (data.ok) {
      me = { ...me, ...data.user };
      setProfileFields();
    }
  }, 1000);
}

$('my-display-name').addEventListener('input', scheduleProfileSave);
$('my-status-msg').addEventListener('input', scheduleProfileSave);

$('status-select').onchange = async () => {
  const status = $('status-select').value;
  const data = await api('PATCH', '/api/users/me', { status });
  if (data.ok) {
    me = { ...me, ...data.user };
    if (socket) socket.emit('status:set', { status });
  }
};

$('avatar-input').onchange = async (event) => {
  const file = event.target.files[0];
  if (!file) return;

  try {
    const avatar_url = await buildAvatarDataUrl(file);
    const data = await api('PATCH', '/api/users/me', { avatar_url });
    if (data.ok) {
      me = { ...me, ...data.user };
      setProfileFields();
      toast('บันทึกรูปโปรไฟล์แล้ว');
    } else {
      toast(data.error || 'บันทึกรูปโปรไฟล์ไม่สำเร็จ');
    }
  } catch (error) {
    toast(error.message || 'อัปโหลดรูปโปรไฟล์ไม่สำเร็จ');
  } finally {
    event.target.value = '';
  }
};

$('copy-id-btn').onclick = () => {
  navigator.clipboard.writeText(me.msn_id).then(() => toast('คัดลอก MSN ID แล้ว'));
};

$('settings-toggle-btn').onclick = () => {
  $('settings-panel').classList.toggle('hidden');
};

$('theme-select').onchange = () => saveSettings({ theme: $('theme-select').value });
$('privacy-select').onchange = () => saveSettings({ privacy_mode: $('privacy-select').value });
$('sounds-toggle').onchange = () => saveSettings({ sounds_enabled: $('sounds-toggle').checked });
$('friend-requests-toggle').onchange = () => saveSettings({ allow_friend_requests: $('friend-requests-toggle').checked });
$('file-transfer-toggle').onchange = () => saveSettings({ allow_file_transfer: $('file-transfer-toggle').checked });

async function loadFriends() {
  const data = await api('GET', '/api/friends');
  if (!data.ok) return;
  friends = data.friends;
  renderFriends();
  renderGroupComposerMembers();
}

function renderFriends() {
  const onlineEl = $('online-list');
  const offlineEl = $('offline-list');
  onlineEl.innerHTML = '';
  offlineEl.innerHTML = '';

  friends.forEach((friend) => {
    const item = document.createElement('div');
    item.className = 'contact-item';
    item.innerHTML = `
      <span class="status-dot ${statusClass(friend.status)}"></span>
      <img class="contact-avatar" src="${friend.avatar_url || 'img/default-avatar.png'}" alt="" />
      <div class="contact-info">
        <div class="contact-name">${escHtml(friend.display_name || friend.username)}</div>
        <div class="contact-status-msg">${escHtml(friend.status_msg || friend.msn_id)}</div>
      </div>
    `;
    item.onclick = () => openDirectChat(friend);
    if (['online', 'away', 'busy', 'be right back'].includes(friend.status)) {
      onlineEl.appendChild(item);
    } else {
      offlineEl.appendChild(item);
    }
  });
}

async function addContact() {
  const msnId = $('add-contact-input').value.trim();
  if (!/^\d{10}$/.test(msnId)) {
    toast('MSN ID ต้องเป็นตัวเลข 10 หลัก');
    return;
  }

  const data = await api('POST', '/api/friends/add', { msn_id: msnId });
  if (!data.ok) {
    toast(data.error);
    return;
  }

  toast('ส่งคำขอเป็นเพื่อนแล้ว');
  $('add-contact-input').value = '';
  if (socket) {
    const userRes = await api('GET', `/api/users/search?msn_id=${msnId}`);
    if (userRes.ok) socket.emit('friend:request_sent', { to_user_id: userRes.user.id });
  }
}

$('add-contact-btn').onclick = addContact;
$('add-contact-input').addEventListener('keydown', (event) => {
  if (event.key === 'Enter') addContact();
});

async function loadPendingRequests() {
  const data = await api('GET', '/api/friends/requests');
  if (!data.ok) return;
  const section = $('requests-section');
  const list = $('requests-list');
  list.innerHTML = '';

  if (!data.requests.length) {
    section.classList.add('hidden');
    return;
  }
  section.classList.remove('hidden');

  data.requests.forEach((request) => {
    const div = document.createElement('div');
    div.className = 'request-item';
    div.innerHTML = `
      <img src="${request.avatar_url || 'img/default-avatar.png'}" class="contact-avatar request-avatar" alt="" />
      <span class="req-name">${escHtml(request.display_name || request.username)}<br><small>${request.msn_id}</small></span>
      <button class="req-accept" data-id="${request.req_id}">✓</button>
      <button class="req-reject" data-id="${request.req_id}">✕</button>
    `;
    list.appendChild(div);
  });

  list.querySelectorAll('.req-accept').forEach((button) => {
    button.onclick = async () => {
      await api('POST', `/api/friends/accept/${button.dataset.id}`);
      await Promise.all([loadFriends(), loadPendingRequests()]);
      toast('ตอบรับคำขอเป็นเพื่อนแล้ว');
    };
  });

  list.querySelectorAll('.req-reject').forEach((button) => {
    button.onclick = async () => {
      await api('POST', `/api/friends/reject/${button.dataset.id}`);
      await loadPendingRequests();
    };
  });
}

async function loadGroups() {
  const data = await api('GET', '/api/chat/groups');
  if (!data.ok) return;
  groups = data.groups;
  renderGroups();
}

function renderGroups() {
  const list = $('groups-list');
  list.innerHTML = '';
  groups.forEach((group) => {
    const groupTitle = (group.title || '').trim() || `Group #${group.id}`;
    const item = document.createElement('div');
    item.className = 'contact-item group-item';
    item.innerHTML = `
      <span class="group-badge">👥</span>
      <div class="contact-info">
        <div class="contact-name">${escHtml(groupTitle)}</div>
        <div class="contact-status-msg">${group.member_count} members${group.last_msg ? ` · ${escHtml(group.last_msg)}` : ''}</div>
      </div>
    `;
    item.onclick = () => openGroupChat(group);
    list.appendChild(item);
  });
}

function renderGroupComposerMembers() {
  const list = $('group-member-list');
  list.innerHTML = '';
  if (!friends.length) {
    list.innerHTML = '<p class="empty-note">Add at least one friend to create a group.</p>';
    return;
  }

  friends.forEach((friend) => {
    const label = document.createElement('label');
    label.className = 'group-member-item';
    label.innerHTML = `
      <input type="checkbox" value="${friend.id}" />
      <img class="contact-avatar group-member-avatar" src="${friend.avatar_url || 'img/default-avatar.png'}" alt="" />
      <span>${escHtml(friend.display_name || friend.username)}</span>
    `;
    list.appendChild(label);
  });
}

$('toggle-group-composer').onclick = () => {
  $('group-composer').classList.toggle('hidden');
  renderGroupComposerMembers();
};

$('cancel-group-btn').onclick = () => {
  $('group-composer').classList.add('hidden');
  $('group-title-input').value = '';
};

$('create-group-btn').onclick = async () => {
  const title = $('group-title-input').value.trim();
  const memberIds = [...$('group-member-list').querySelectorAll('input:checked')].map((input) => Number(input.value));
  const data = await api('POST', '/api/chat/groups', { title, member_ids: memberIds });
  if (!data.ok) {
    toast(data.error || 'สร้างกลุ่มไม่สำเร็จ');
    return;
  }

  $('group-composer').classList.add('hidden');
  $('group-title-input').value = '';
  await loadGroups();
  const group = groups.find((entry) => entry.id === data.group.id) || { ...data.group, member_count: memberIds.length + 1 };
  openGroupChat(group);
  toast('สร้างกลุ่มใหม่แล้ว');
};

function buildWindowMeta(kind, source) {
  if (kind === 'direct') {
    return {
      key: directKey(source.id),
      kind,
      targetId: source.id,
      title: source.display_name || source.username,
      subtitle: source.status || 'offline',
      avatar: source.avatar_url || 'img/default-avatar.png',
      contact: source,
    };
  }

  return {
    key: groupKey(source.id),
    kind,
    targetId: source.id,
    title: source.title,
    subtitle: `${source.member_count || 0} members`,
    avatar: 'img/default-avatar.png',
    group: source,
  };
}

async function openDirectChat(friend) {
  return openConversationWindow(buildWindowMeta('direct', friend));
}

async function openGroupChat(group) {
  return openConversationWindow(buildWindowMeta('group', group));
}

async function openConversationWindow(meta) {
  if (chatWindows[meta.key]) {
    activateEmbeddedChat(chatWindows[meta.key]);
    chatWindows[meta.key].querySelector('.chat-input').focus();
    return chatWindows[meta.key];
  }

  const tpl = document.getElementById('chat-window-tpl');
  const win = tpl.content.cloneNode(true).querySelector('.chat-window');
  win.dataset.chatKey = meta.key;
  win.dataset.chatKind = meta.kind;
  win.dataset.targetId = meta.targetId;

  win.querySelector('.chat-partner-name').textContent = meta.title;
  win.querySelector('.chat-partner-display').textContent = meta.title;
  win.querySelector('.chat-partner-status').textContent = meta.subtitle;
  win.querySelector('.chat-partner-avatar').src = meta.avatar;

  if (!isEmbeddedMode) {
    const offset = Object.keys(chatWindows).length * 28;
    win.style.top = `${60 + offset}px`;
    win.style.left = `${320 + offset}px`;
  }

  const input = win.querySelector('.chat-input');
  const fileInput = win.querySelector('.file-input');
  const typingIndicator = win.querySelector('.typing-indicator');
  const callStrip = win.querySelector('.call-strip');
  const callStatus = win.querySelector('.call-status');
  const mediaStage = win.querySelector('.media-stage');
  const localVideo = win.querySelector('.local-video');
  const remoteVideo = win.querySelector('.remote-video');
  if (meta.kind === 'group') typingIndicator.classList.add('hidden');

  if (meta.kind === 'group') {
    win.querySelector('.group-rename-btn').classList.remove('hidden');
    win.querySelector('.group-invite-btn').classList.remove('hidden');
    win.querySelector('.group-members-btn').classList.remove('hidden');
    win.querySelector('.group-leave-btn').classList.remove('hidden');
  }

  win.querySelector('.chat-close').onclick = () => {
    endCallForWindow(win, true);
    forgetOpenConversation(meta.key);
    win.remove();
    delete chatWindows[meta.key];
    if (isEmbeddedMode) {
      const nextWin = Object.values(chatWindows)[0];
      if (nextWin) activateEmbeddedChat(nextWin);
    }
  };

  win.querySelector('.send-btn').onclick = () => sendTextMessage(meta, win, input);
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      sendTextMessage(meta, win, input);
    }
  });

  if (meta.kind === 'direct') {
    input.addEventListener('input', () => {
      if (socket) socket.emit('typing:start', { to_user_id: meta.targetId });
      clearTimeout(typingTimers[meta.key]);
      typingTimers[meta.key] = setTimeout(() => {
        if (socket) socket.emit('typing:stop', { to_user_id: meta.targetId });
      }, TYPING_DEBOUNCE);
    });
  }

  win.querySelector('.nudge-btn').onclick = () => sendTextMessage(meta, win, null, 'nudge', '💥 Nudge!');
  win.querySelector('.wink-btn').onclick = () => sendTextMessage(meta, win, null, 'wink', '😜 Wink~');
  win.querySelector('.attach-btn').onclick = () => fileInput.click();
  fileInput.onchange = () => sendFileMessage(meta, win, fileInput, input);

  win.querySelector('.group-rename-btn').onclick = () => renameGroup(meta);
  win.querySelector('.group-invite-btn').onclick = () => inviteMembers(meta);
  win.querySelector('.group-members-btn').onclick = () => manageMembers(meta);
  win.querySelector('.group-leave-btn').onclick = () => leaveGroup(meta, win);

  win.querySelector('.call-voice-btn').onclick = () => initiateCall(meta, win, 'voice');
  win.querySelector('.call-video-btn').onclick = () => initiateCall(meta, win, 'video');
  win.querySelector('.end-call-btn').onclick = () => endCallForWindow(win, false);

  callStrip.classList.add('hidden');
  mediaStage.classList.add('hidden');
  localVideo.srcObject = null;
  remoteVideo.srcObject = null;
  callStatus.textContent = 'Call inactive';

  $('chat-windows').appendChild(win);
  chatWindows[meta.key] = win;
  if (isEmbeddedMode) {
    const headerActions = win.querySelector('.chat-header-actions');
    if (headerActions && !headerActions.querySelector('.embedded-close-btn')) {
      const closeBtn = document.createElement('button');
      closeBtn.className = 'chat-mini-btn embedded-close-btn';
      closeBtn.title = 'Close chat';
      closeBtn.textContent = 'x';
      closeBtn.onclick = () => win.querySelector('.chat-close').click();
      headerActions.appendChild(closeBtn);
    }
  }
  rememberOpenConversation(meta);
  if (!isEmbeddedMode) {
    makeDraggable(win, win.querySelector('.chat-titlebar'));
  }
  activateEmbeddedChat(win);

  const historyPath = meta.kind === 'direct'
    ? `/api/chat/${meta.targetId}/messages`
    : `/api/chat/conversations/${meta.targetId}/messages`;
  const history = await api('GET', historyPath);
  if (history.ok) {
    history.messages.forEach((message) => appendMessage(win, message, meta));
  }

  win.querySelector('.chat-messages').scrollTop = win.querySelector('.chat-messages').scrollHeight;
  input.focus();
  return win;
}

async function renameGroup(meta) {
  if (meta.kind !== 'group') return;
  const newTitle = prompt('Rename group', meta.title || '');
  if (!newTitle) return;

  const data = await api('PATCH', `/api/chat/groups/${meta.targetId}`, { title: newTitle });
  if (!data.ok) {
    toast(data.error || 'เปลี่ยนชื่อไม่สำเร็จ');
    return;
  }

  meta.title = data.group.title;
  const win = chatWindows[meta.key];
  if (win) {
    win.querySelector('.chat-partner-name').textContent = data.group.title;
    win.querySelector('.chat-partner-display').textContent = data.group.title;
  }
  await loadGroups();
  if (socket) {
    const membersRes = await api('GET', `/api/chat/groups/${meta.targetId}/members`);
    if (membersRes.ok) socket.emit('group:notify', {
      conversation_id: meta.targetId,
      member_ids: membersRes.members.map((m) => m.id),
      type: 'rename'
    });
  }
}

async function inviteMembers(meta) {
  if (meta.kind !== 'group') return;
  const input = prompt('Invite by user ids (comma separated)');
  if (!input) return;
  const memberIds = input.split(',').map((v) => Number(v.trim())).filter(Boolean);
  const data = await api('POST', `/api/chat/groups/${meta.targetId}/invite`, { member_ids: memberIds });
  if (!data.ok) {
    toast(data.error || 'เชิญสมาชิกไม่สำเร็จ');
    return;
  }
  toast('เชิญสมาชิกแล้ว');
  await loadGroups();
  if (socket) socket.emit('group:notify', { conversation_id: meta.targetId, member_ids: data.members.map((m) => m.id), type: 'invite' });
}

async function manageMembers(meta) {
  if (meta.kind !== 'group') return;
  const data = await api('GET', `/api/chat/groups/${meta.targetId}/members`);
  if (!data.ok) {
    toast(data.error || 'โหลดสมาชิกไม่สำเร็จ');
    return;
  }

  const ownerTag = (id) => Number(id) === Number(data.owner_id) ? ' (owner)' : '';
  const summary = data.members.map((m) => `${m.id}: ${m.display_name}${ownerTag(m.id)}`).join('\n');
  const memberId = prompt(`Members:\n${summary}\n\nType member id to remove:`);
  if (!memberId) return;

  const removeRes = await api('DELETE', `/api/chat/groups/${meta.targetId}/members/${memberId}`);
  if (!removeRes.ok) {
    toast(removeRes.error || 'ลบสมาชิกไม่สำเร็จ');
    return;
  }
  toast('ลบสมาชิกแล้ว');
  await loadGroups();
  if (socket) socket.emit('group:notify', {
    conversation_id: meta.targetId,
    member_ids: removeRes.members.map((m) => m.id),
    type: 'remove-member'
  });
}

async function leaveGroup(meta, win) {
  if (meta.kind !== 'group') return;
  if (!confirm('Leave this group?')) return;
  const data = await api('POST', `/api/chat/groups/${meta.targetId}/leave`);
  if (!data.ok) {
    toast(data.error || 'ออกจากกลุ่มไม่สำเร็จ');
    return;
  }
  endCallForWindow(win, true);
  forgetOpenConversation(meta.key);
  win.remove();
  delete chatWindows[meta.key];
  await loadGroups();
  toast('ออกจากกลุ่มแล้ว');
}

async function sendTextMessage(meta, win, inputEl, msgType = 'text', preset = null) {
  const content = preset ?? (inputEl ? inputEl.value.trim() : '');
  if (!content) return;

  const payload = meta.kind === 'direct'
    ? { to_user_id: meta.targetId, content, msg_type: msgType }
    : { conversation_id: meta.targetId, content, msg_type: msgType };

  const message = await sendPayload(meta, payload, msgType === 'file' ? '/send-file' : '/send');
  if (message) {
    appendMessage(win, message, meta);
    win.querySelector('.chat-messages').scrollTop = win.querySelector('.chat-messages').scrollHeight;
    if (inputEl) inputEl.value = '';
  }
}

async function sendFileMessage(meta, win, fileInput, inputEl) {
  const file = fileInput.files[0];
  if (!file) return;
  if (file.size > MAX_FILE_BYTES) {
    toast('ไฟล์ต้องไม่เกิน 10MB');
    fileInput.value = '';
    return;
  }

  if (!settings.allow_file_transfer) {
    toast('คุณปิดการส่งไฟล์ไว้ใน Settings');
    fileInput.value = '';
    return;
  }

  const attachment = await new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve({
      name: file.name,
      type: file.type || 'application/octet-stream',
      size: file.size,
      data: reader.result,
    });
    reader.readAsDataURL(file);
  });

  const payload = meta.kind === 'direct'
    ? { to_user_id: meta.targetId, content: inputEl.value.trim(), msg_type: 'file', attachment }
    : { conversation_id: meta.targetId, content: inputEl.value.trim(), msg_type: 'file', attachment };

  const message = await sendPayload(meta, payload, '/send-file');
  if (message) {
    appendMessage(win, message, meta);
    win.querySelector('.chat-messages').scrollTop = win.querySelector('.chat-messages').scrollHeight;
    inputEl.value = '';
    fileInput.value = '';
  }
}

async function sendPayload(meta, payload, fallbackSuffix) {
  if (socket && socket.connected) {
    const response = await new Promise((resolve) => {
      socket.emit('message:send', payload, resolve);
    });
    if (response?.ok) return response.message;
    toast(response?.error || 'ส่งข้อความไม่สำเร็จ');
    return null;
  }

  const endpoint = meta.kind === 'direct'
    ? `/api/chat/${meta.targetId}${fallbackSuffix}`
    : `/api/chat/conversations/${meta.targetId}${fallbackSuffix}`;
  const response = await api('POST', endpoint, meta.kind === 'direct'
    ? { content: payload.content, msg_type: payload.msg_type, attachment: payload.attachment, caption: payload.content }
    : { content: payload.content, msg_type: payload.msg_type, attachment: payload.attachment, caption: payload.content });
  if (!response.ok) {
    toast(response.error || 'ส่งข้อความไม่สำเร็จ');
    return null;
  }
  return response.message;
}

function appendMessage(win, msg, meta) {
  const row = document.createElement('div');
  const isMine = msg.sender_id === me.id;
  row.className = `msg-row ${isMine ? 'mine' : 'theirs'}`;

  const senderName = msg.sender_name || (isMine ? (me.display_name || me.username) : meta.title);
  let bodyHtml = '';

  if (msg.msg_type === 'file' && (msg.attachment_url || msg.attachment_data)) {
    const href = msg.attachment_url || msg.attachment_data;
    const isImageAttachment = String(msg.attachment_type || '').startsWith('image/');
    bodyHtml = `
      <div class="file-card">
        ${isImageAttachment ? `<a href="${href}" target="_blank" rel="noopener"><img class="chat-inline-image" src="${href}" alt="${escHtml(msg.attachment_name || 'image')}" /></a>` : ''}
        <a class="file-link" href="${href}" download="${escHtml(msg.attachment_name || 'file')}" target="_blank" rel="noopener">${escHtml(msg.attachment_name || 'Download file')}</a>
        <small>${Math.max(1, Math.round((msg.attachment_size || 0) / 1024))} KB</small>
      </div>
    `;
    if (msg.content) bodyHtml += `<div class="file-caption">${escHtml(msg.content)}</div>`;
  } else {
    bodyHtml = escHtml(msg.content);
  }

  row.innerHTML = `
    <div class="msg-sender">${escHtml(senderName)}</div>
    <div class="msg-bubble ${msg.msg_type !== 'text' ? escHtml(msg.msg_type) : ''}">${bodyHtml}</div>
    <div class="msg-time">${fmtTime(msg.sent_at)}</div>
  `;
  win.querySelector('.chat-messages').appendChild(row);
}

function connectSocket() {
  socket = io({ auth: { token: '' }, withCredentials: true });

  socket.on('message:new', async (msg) => {
    if (msg.conversation_kind === 'group') {
      const key = groupKey(msg.conversation_id);
      let win = chatWindows[key];
      if (!win) {
        const group = groups.find((entry) => entry.id === msg.conversation_id) || {
          id: msg.conversation_id,
          title: msg.conversation_title || 'Group Chat',
          member_count: 0,
        };
        win = await openGroupChat(group);
      }
      if (win) {
        appendMessage(win, msg, buildWindowMeta('group', groups.find((entry) => entry.id === msg.conversation_id) || { id: msg.conversation_id, title: msg.conversation_title || 'Group Chat', member_count: 0 }));
        win.querySelector('.chat-messages').scrollTop = 9999;
      }
      toast(`👥 ข้อความใหม่ใน ${msg.conversation_title || 'Group Chat'}`);
      loadGroups();
      return;
    }

    const peerUserId = msg.sender_id === me.id ? msg.peer_user_id : msg.sender_id;
    const key = directKey(peerUserId);
    let win = chatWindows[key];
    const friend = friends.find((entry) => entry.id === peerUserId) || { id: peerUserId, display_name: msg.sender_name, status: 'online' };
    if (!win) {
      win = await openDirectChat(friend);
      toast(`💬 ข้อความใหม่จาก ${friend.display_name || friend.username}`);
    }
    if (win) {
      appendMessage(win, msg, buildWindowMeta('direct', friend));
      win.querySelector('.chat-messages').scrollTop = 9999;
    }
  });

  socket.on('typing:start', ({ from_user_id, name }) => {
    const win = chatWindows[directKey(from_user_id)];
    if (!win) return;
    win.querySelector('.typing-text').textContent = `${name} กำลังพิมพ์...`;
    win.querySelector('.typing-indicator').classList.remove('hidden');
  });

  socket.on('typing:stop', ({ from_user_id }) => {
    const win = chatWindows[directKey(from_user_id)];
    if (!win) return;
    win.querySelector('.typing-indicator').classList.add('hidden');
  });

  socket.on('status:changed', ({ user_id, status }) => {
    const friend = friends.find((entry) => entry.id === user_id);
    if (!friend) return;
    friend.status = status;
    renderFriends();
    const win = chatWindows[directKey(user_id)];
    if (win) win.querySelector('.chat-partner-status').textContent = status;
  });

  socket.on('friend:request_received', (sender) => {
    toast(`👤 ${sender.display_name || sender.username} ขอเป็นเพื่อน (${sender.msn_id})`);
    loadPendingRequests();
  });

  socket.on('group:updated', () => {
    loadGroups();
  });

  socket.on('call:incoming', async ({ from_user_id, call_id, call_type }) => {
    const friend = friends.find((f) => f.id === from_user_id);
    if (!friend) return;
    const accepted = confirm(`${friend.display_name || friend.username} calling (${call_type}). Accept?`);
    if (!accepted) {
      socket.emit('call:reject', { to_user_id: from_user_id, call_id });
      return;
    }

    try {
      socket.emit('call:accept', { to_user_id: from_user_id, call_id });
      const win = await openDirectChat(friend);
      await beginPeerConnection(win, from_user_id, call_id, call_type, false);
    } catch (error) {
      socket.emit('call:reject', { to_user_id: from_user_id, call_id });
      toast(error.message || 'เปิดไมค์หรือกล้องไม่สำเร็จ');
    }
  });

  socket.on('call:accepted', async ({ from_user_id, call_id }) => {
    const key = directKey(from_user_id);
    const state = activeCalls.get(key);
    if (!state) return;
    const offer = await state.pc.createOffer();
    await state.pc.setLocalDescription(offer);
    socket.emit('webrtc:offer', { to_user_id: from_user_id, call_id, sdp: offer });
    const win = chatWindows[key];
    if (win) {
      win.querySelector('.call-status').textContent = `Connecting ${state.callType} call...`;
    }
  });

  socket.on('call:rejected', ({ from_user_id }) => {
    toast('Call rejected');
    const win = chatWindows[directKey(from_user_id)];
    if (win) endCallForWindow(win, true);
  });

  socket.on('call:ended', ({ from_user_id }) => {
    const win = chatWindows[directKey(from_user_id)];
    if (win) endCallForWindow(win, true);
  });

  socket.on('webrtc:offer', async ({ from_user_id, call_id, sdp }) => {
    const win = chatWindows[directKey(from_user_id)];
    if (!win) return;
    const state = activeCalls.get(win.dataset.chatKey);
    if (!state) return;
    await state.pc.setRemoteDescription(new RTCSessionDescription(sdp));
    const answer = await state.pc.createAnswer();
    await state.pc.setLocalDescription(answer);
    socket.emit('webrtc:answer', { to_user_id: from_user_id, call_id, sdp: answer });
  });

  socket.on('webrtc:answer', async ({ from_user_id, sdp }) => {
    const win = chatWindows[directKey(from_user_id)];
    if (!win) return;
    const state = activeCalls.get(win.dataset.chatKey);
    if (!state) return;
    await state.pc.setRemoteDescription(new RTCSessionDescription(sdp));
    win.querySelector('.call-status').textContent = `${state.callType} call live`;
  });

  socket.on('webrtc:ice-candidate', async ({ from_user_id, candidate }) => {
    const win = chatWindows[directKey(from_user_id)];
    if (!win) return;
    const state = activeCalls.get(win.dataset.chatKey);
    if (!state || !candidate) return;
    await state.pc.addIceCandidate(new RTCIceCandidate(candidate));
  });
}

async function initiateCall(meta, win, callType) {
  if (meta.kind !== 'direct') {
    toast('Voice/Video ตอนนี้รองรับแชต 1:1 เท่านั้น');
    return;
  }
  const callId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  try {
    await beginPeerConnection(win, meta.targetId, callId, callType, true);
    socket.emit('call:invite', { to_user_id: meta.targetId, call_id: callId, call_type: callType });
  } catch (error) {
    toast(error.message || 'เริ่มสายสนทนาไม่สำเร็จ');
    endCallForWindow(win, true);
  }
}

async function beginPeerConnection(win, peerUserId, callId, callType, outgoing) {
  const key = win.dataset.chatKey;
  endCallForWindow(win, true);

  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error('เบราว์เซอร์นี้ยังไม่รองรับการโทร');
  }

  const localStream = await navigator.mediaDevices.getUserMedia({
    audio: true,
    video: callType === 'video',
  });

  const pc = new RTCPeerConnection(webrtcConfig);
  localStream.getTracks().forEach((track) => pc.addTrack(track, localStream));

  const remoteStream = new MediaStream();
  pc.ontrack = (event) => {
    event.streams[0].getTracks().forEach((track) => remoteStream.addTrack(track));
    win.querySelector('.remote-video').srcObject = remoteStream;
  };

  pc.onicecandidate = (event) => {
    if (!event.candidate) return;
    socket.emit('webrtc:ice-candidate', {
      to_user_id: peerUserId,
      call_id: callId,
      candidate: event.candidate,
    });
  };

  win.querySelector('.local-video').srcObject = localStream;
  win.querySelector('.media-stage').classList.remove('hidden');
  win.querySelector('.call-strip').classList.remove('hidden');
  win.querySelector('.call-status').textContent = outgoing ? `Calling (${callType})...` : `Call connected (${callType})`;

  activeCalls.set(key, {
    callId,
    peerUserId,
    callType,
    pc,
    localStream,
  });
}

function endCallForWindow(win, silent) {
  const key = win.dataset.chatKey;
  const state = activeCalls.get(key);
  if (!state) return;

  try { state.pc.close(); } catch (_) {}
  try { state.localStream.getTracks().forEach((track) => track.stop()); } catch (_) {}

  win.querySelector('.local-video').srcObject = null;
  win.querySelector('.remote-video').srcObject = null;
  win.querySelector('.media-stage').classList.add('hidden');
  win.querySelector('.call-strip').classList.add('hidden');
  win.querySelector('.call-status').textContent = 'Call inactive';

  if (!silent && socket) {
    socket.emit('call:end', { to_user_id: state.peerUserId, call_id: state.callId });
  }
  activeCalls.delete(key);
}

function makeDraggable(win, handle) {
  let ox = 0;
  let oy = 0;
  handle.addEventListener('pointerdown', (event) => {
    event.preventDefault();
    const rect = win.getBoundingClientRect();
    ox = event.clientX - rect.left;
    oy = event.clientY - rect.top;
    win.style.zIndex = 300;

    function onMove(moveEvent) {
      win.style.left = `${Math.max(0, moveEvent.clientX - ox)}px`;
      win.style.top = `${Math.max(0, moveEvent.clientY - oy)}px`;
    }

    function onUp() {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    }

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  });
}

if (isEmbeddedMode) {
  $('buddy-window').style.left = '';
  $('buddy-window').style.top = '';
} else {
  makeDraggable($('buddy-window'), $('buddy-window').querySelector('.msn-titlebar'));
}

init();