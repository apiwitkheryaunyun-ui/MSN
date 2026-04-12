'use strict';

const assert = require('assert/strict');
const { io } = require('socket.io-client');

const BASE_URL = process.env.SMOKE_BASE_URL || 'http://localhost:3000';

function randomUserSeed() {
  return `${Date.now()}${Math.floor(Math.random() * 1e6)}`;
}

class Session {
  constructor(name) {
    this.name = name;
    this.cookie = '';
  }

  async request(path, { method = 'GET', body } = {}) {
    const headers = { 'Content-Type': 'application/json' };
    if (this.cookie) {
      headers.Cookie = this.cookie;
    }

    const res = await fetch(`${BASE_URL}${path}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });

    const setCookie = res.headers.get('set-cookie');
    if (setCookie && setCookie.includes('token=')) {
      this.cookie = setCookie.split(';')[0];
    }

    const text = await res.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      data = { ok: false, error: text };
    }

    return { status: res.status, ok: res.ok, data };
  }
}

async function register(session, label) {
  const seed = randomUserSeed();
  const email = `${label}-${seed}@example.com`;
  const username = `${label}${seed}`.slice(0, 30);
  const password = 'Passw0rd!123';

  const res = await session.request('/api/auth/register', {
    method: 'POST',
    body: {
      username,
      display_name: `${label.toUpperCase()} User`,
      email,
      password,
    },
  });

  assert.equal(res.status, 201, `${label} register failed: ${JSON.stringify(res.data)}`);
  assert.equal(res.data.ok, true, `${label} register response not ok`);
  return res.data.user;
}

function connectSocket(cookie) {
  const token = String(cookie || '').startsWith('token=')
    ? String(cookie).slice('token='.length)
    : '';
  return io(BASE_URL, {
    transports: ['websocket'],
    auth: token ? { token } : undefined,
    withCredentials: true,
    extraHeaders: cookie ? { Cookie: cookie } : undefined,
  });
}

async function waitForEvent(socket, eventName, timeoutMs = 6000) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      socket.off(eventName, handler);
      reject(new Error(`Timeout waiting for ${eventName}`));
    }, timeoutMs);

    function handler(payload) {
      clearTimeout(timeout);
      resolve(payload);
    }

    socket.once(eventName, handler);
  });
}

async function run() {
  const a = new Session('a');
  const b = new Session('b');

  console.log('1) Register two users');
  const userA = await register(a, 'smokea');
  const userB = await register(b, 'smokeb');

  console.log('2) Create friendship');
  const addRes = await a.request('/api/friends/add', {
    method: 'POST',
    body: { msn_id: userB.msn_id },
  });
  assert.equal(addRes.status, 201, `friend add failed: ${JSON.stringify(addRes.data)}`);

  const reqRes = await b.request('/api/friends/requests');
  assert.equal(reqRes.status, 200, 'fetch friend requests failed');
  assert.ok(Array.isArray(reqRes.data.requests) && reqRes.data.requests.length > 0, 'no pending request found');
  const reqId = reqRes.data.requests[0].req_id;

  const acceptRes = await b.request(`/api/friends/accept/${reqId}`, { method: 'POST' });
  assert.equal(acceptRes.status, 200, `accept request failed: ${JSON.stringify(acceptRes.data)}`);

  console.log('3) Smoke flow: create group');
  const groupRes = await a.request('/api/chat/groups', {
    method: 'POST',
    body: {
      title: 'Smoke Group',
      member_ids: [userB.id],
    },
  });
  assert.equal(groupRes.status, 201, `create group failed: ${JSON.stringify(groupRes.data)}`);
  assert.equal(groupRes.data.ok, true, 'group response not ok');

  console.log('4) Smoke flow: send file');
  const fileRes = await a.request(`/api/chat/${userB.id}/send-file`, {
    method: 'POST',
    body: {
      content: 'smoke-file',
      attachment: {
        name: 'smoke.txt',
        type: 'text/plain',
        size: 22,
        data: 'data:text/plain;base64,c21va2UgdGVzdCBmaWxlIGNvbnRlbnQ=',
      },
    },
  });
  assert.equal(fileRes.status, 201, `send file failed: ${JSON.stringify(fileRes.data)}`);

  console.log('5) Smoke flow: history survives reload');
  const historyRes = await b.request(`/api/chat/${userA.id}/messages`);
  assert.equal(historyRes.status, 200, 'history fetch failed');
  assert.ok(historyRes.data.messages.some((m) => m.msg_type === 'file'), 'file message missing in history');

  console.log('6) Smoke flow: 1:1 call signaling');
  const sockA = connectSocket(a.cookie);
  const sockB = connectSocket(b.cookie);

  await Promise.all([
    waitForEvent(sockA, 'connect'),
    waitForEvent(sockB, 'connect'),
  ]);

  const callId = `smoke-${Date.now()}`;
  const incomingPromise = waitForEvent(sockB, 'call:incoming');
  sockA.emit('call:invite', { to_user_id: userB.id, call_id: callId, call_type: 'voice' });

  const incoming = await incomingPromise;
  assert.equal(incoming.call_id, callId, 'incoming call id mismatch');

  const acceptedPromise = waitForEvent(sockA, 'call:accepted');
  sockB.emit('call:accept', { to_user_id: userA.id, call_id: callId });
  const accepted = await acceptedPromise;
  assert.equal(accepted.call_id, callId, 'call accept id mismatch');

  sockA.close();
  sockB.close();

  console.log('Smoke tests passed');
}

run().catch((error) => {
  console.error('Smoke tests failed:', error.message || error);
  process.exit(1);
});
