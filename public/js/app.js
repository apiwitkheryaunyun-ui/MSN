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
let contactSearchQuery = '';
const isEmbeddedMode = window.self !== window.top;
const isTabletViewport = () => window.matchMedia('(min-width: 768px) and (max-width: 1024px)').matches;
const isMobileViewport = () => window.matchMedia('(max-width: 767px)').matches;
const isEmbeddedCompact = () => isEmbeddedMode && window.matchMedia('(max-width: 760px)').matches;
const isFixedPaneMode = () => {
  if (isEmbeddedMode) return isEmbeddedCompact();
  return isTabletViewport() || isMobileViewport();
};
const isPaneSwitching = () => {
  if (isEmbeddedMode) return isEmbeddedCompact();
  return isMobileViewport();
};

const TYPING_DEBOUNCE = 1500;
const MAX_FILE_BYTES = 10 * 1024 * 1024;
const MAX_AVATAR_EXPORT_BYTES = 320 * 1024;
const AVATAR_CANVAS_SIZE = 180;
const OPEN_CONVERSATIONS_KEY = 'msn-open-conversations';
const WINDOW_SNAP_PX = 12;
const SOUND_ASSETS = {
  message_in: 'sounds/message-in.wav',
  nudge: 'sounds/nudge.wav',
  online: 'sounds/online.wav',
  sign_in: 'sounds/sign-in.wav',
  error: 'sounds/error.wav',
};
const SOUND_FREQ = {
  message_in: 980,
  nudge: 160,
  online: 620,
  sign_in: 780,
  error: 220,
};

let topWindowZ = 320;
let audioCtx = null;
const $ = (id) => document.getElementById(id);
const authScreen = $('auth-screen');
const app = $('app');
const loginPanel = $('login-panel');
const registerPanel = $('register-panel');
const promptStudioWindow = $('prompt-studio-window');

const PROMPT_WORKFLOWS = {
  engagement: {
    label: 'Content Engagement',
    description: 'Craft replies, caption ideas, and community-facing conversation starters that match your brand voice.',
    build(fields) {
      return [
        `You are a senior social media strategist for ${fields.brand}.`,
        `Create a content engagement playbook for ${fields.platform} aimed at ${fields.audience}.`,
        `Voice and tone: ${fields.tone}.`,
        `Primary goal: ${fields.goal}.`,
        `Use this post or asset summary as the source material: ${fields.assetSummary}.`,
        `Prioritize these response moments: ${fields.responsePriority}.`,
        `Call to action to reinforce: ${fields.cta}.`,
        `Guardrails: ${fields.constraints}.`,
        `Output language: ${fields.language}.`,
        'Return:',
        '1. Three reply strategies for comments and DMs.',
        '2. Eight on-brand sample replies with short rationale.',
        '3. Three ways to re-engage silent followers.',
        '4. A short escalation rule for questions that should move to sales or support.',
      ].join('\n');
    },
  },
  scheduled: {
    label: 'Scheduled Posting',
    description: 'Generate a calendar-minded prompt for batching posts, sequencing content, and aligning each slot to a campaign goal.',
    build(fields) {
      return [
        `Act as a social content planner for ${fields.brand}.`,
        `Design a scheduled posting plan for ${fields.platform} targeting ${fields.audience}.`,
        `Campaign goal: ${fields.goal}.`,
        `Brand tone: ${fields.tone}.`,
        `Publishing window: ${fields.scheduleWindow}.`,
        `Desired content mix: ${fields.contentMix}.`,
        `Campaign context: ${fields.campaignContext}.`,
        `CTA direction: ${fields.cta}.`,
        `Guardrails: ${fields.constraints}.`,
        `Output language: ${fields.language}.`,
        'Return:',
        '1. A posting calendar with date/theme/hook/format/CTA.',
        '2. Suggested best posting times and why.',
        '3. Asset checklist per post.',
        '4. A fallback variant for underperforming posts.',
      ].join('\n');
    },
  },
  listening: {
    label: 'Social Listening',
    description: 'Summarize public sentiment, map response priorities, and prepare safe brand responses for emerging issues.',
    build(fields) {
      return [
        `You are monitoring online conversation for ${fields.brand}.`,
        `Analyze social listening signals from ${fields.platform} for ${fields.audience}.`,
        `Current signal: ${fields.signal}.`,
        `Risk level: ${fields.riskLevel}.`,
        `Brand tone for responses: ${fields.tone}.`,
        `Business objective: ${fields.goal}.`,
        `Source notes: ${fields.sourceNotes}.`,
        `Required safeguards: ${fields.constraints}.`,
        `Output language: ${fields.language}.`,
        'Return:',
        '1. A sentiment summary with likely root causes.',
        '2. Priority segments to respond to first.',
        '3. Six brand-safe public response drafts.',
        '4. Escalation guidance for legal, support, and PR teams.',
      ].join('\n');
    },
  },
  influencer: {
    label: 'Influencer Research',
    description: 'Build a scouting prompt for finding creators who fit your market, budget, and credibility requirements.',
    build(fields) {
      return [
        `Act as an influencer research lead for ${fields.brand}.`,
        `Find creator opportunities for ${fields.platform} targeting ${fields.audience}.`,
        `Campaign goal: ${fields.goal}.`,
        `Preferred brand tone: ${fields.tone}.`,
        `Creator niche: ${fields.niche}.`,
        `Region: ${fields.region}.`,
        `Budget or scale guidance: ${fields.budget}.`,
        `Selection criteria: ${fields.selectionCriteria}.`,
        `Guardrails: ${fields.constraints}.`,
        `Output language: ${fields.language}.`,
        'Return:',
        '1. A creator qualification scorecard.',
        '2. Ten search filters or discovery queries.',
        '3. A table structure for comparing creators.',
        '4. Outreach angle suggestions and fraud-risk checks.',
      ].join('\n');
    },
  },
};

const PROMPT_SEEDS = {
  engagement: {
    workflow: 'engagement',
    brand: 'Contoso Skincare',
    platform: 'Instagram + TikTok',
    audience: 'Thai Gen Z skincare shoppers',
    tone: 'Friendly, smart, fast, reassuring',
    goal: 'Increase comments, saves, and qualified product questions',
    language: 'Thai + English',
    assetSummary: 'A short-form video debunking sunscreen myths with dermatologist-backed facts.',
    cta: 'Invite followers to share their sunscreen struggles in comments',
    responsePriority: 'Product objections, acne-prone questions, purchase-intent comments',
    constraints: 'No medical claims, avoid sounding salesy, keep replies under 45 words',
  },
  scheduled: {
    workflow: 'scheduled',
    brand: 'Northwind Travel',
    platform: 'Facebook + Instagram',
    audience: 'Young professionals planning long-weekend trips',
    tone: 'Energetic, polished, discovery-focused',
    goal: 'Drive itinerary downloads and DM inquiries',
    language: 'English',
    scheduleWindow: 'Next 2 weeks, 4 posts per week',
    contentMix: 'Destination reels, carousel tips, customer testimonials, story reminders',
    campaignContext: 'Promoting curated weekend trips with limited-time booking perks.',
    cta: 'Push users toward DM for quote and itinerary link',
    constraints: 'Keep captions under 110 words, one CTA per post, no repeated hooks',
  },
  listening: {
    workflow: 'listening',
    brand: 'Fabrikam Delivery',
    platform: 'X, Facebook comments, Reddit mentions',
    audience: 'Urban users ordering same-day groceries',
    tone: 'Calm, accountable, precise',
    goal: 'Reduce churn risk and respond quickly to shipping frustration',
    language: 'Thai',
    signal: 'Sudden rise in complaints about late deliveries after a warehouse move',
    riskLevel: 'High',
    sourceNotes: 'Users mention cold items arriving late, support response delays, and promo code errors.',
    constraints: 'Acknowledge issue clearly, avoid blame, never promise compensation before verification',
  },
  influencer: {
    workflow: 'influencer',
    brand: 'Adventure Works Outdoors',
    platform: 'YouTube Shorts + TikTok',
    audience: 'Entry-level hikers and trail runners in Thailand',
    tone: 'Credible, rugged, helpful',
    goal: 'Identify trustworthy creators for a product seeding campaign',
    language: 'English',
    niche: 'Outdoor creators, hiking educators, trail gear reviewers',
    budget: 'Micro to mid-tier creators, total budget under 80k THB',
    region: 'Thailand',
    selectionCriteria: 'Good comment quality, visible trail experience, low fake-engagement risk, audience fit',
    constraints: 'Exclude creators with poor disclosure habits or unrelated luxury content',
  },
};

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

function bumpWindowToFront(win) {
  topWindowZ += 1;
  win.style.zIndex = String(topWindowZ);
}

function ensureAudioContext() {
  if (audioCtx) return audioCtx;
  const Ctx = window.AudioContext || window.webkitAudioContext;
  if (!Ctx) return null;
  audioCtx = new Ctx();
  return audioCtx;
}

function playFallbackTone(name) {
  if (!settings.sounds_enabled) return;
  const ctx = ensureAudioContext();
  if (!ctx) return;

  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = name === 'nudge' ? 'square' : 'sine';
  osc.frequency.value = SOUND_FREQ[name] || 540;
  gain.gain.value = 0.0001;
  osc.connect(gain);
  gain.connect(ctx.destination);
  const now = ctx.currentTime;
  gain.gain.exponentialRampToValueAtTime(0.08, now + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + (name === 'nudge' ? 0.22 : 0.14));
  osc.start(now);
  osc.stop(now + (name === 'nudge' ? 0.24 : 0.16));
}

function playSound(name) {
  if (!settings.sounds_enabled) return;
  const src = SOUND_ASSETS[name];
  if (!src) {
    playFallbackTone(name);
    return;
  }

  const audio = new Audio(src);
  audio.volume = name === 'nudge' ? 0.7 : 0.55;
  audio.play().catch(() => playFallbackTone(name));
}

function hydrateTooltips(root = document) {
  root.querySelectorAll('[title]').forEach((el) => {
    const tip = el.getAttribute('title');
    if (!tip || el.dataset.xpTip) return;
    el.dataset.xpTip = tip;
    el.setAttribute('aria-label', tip);
    el.removeAttribute('title');
    el.classList.add('xp-tip-target');
  });
}

function initButtonRipple() {
  if (initButtonRipple._ready) return;
  initButtonRipple._ready = true;

  document.addEventListener('click', (event) => {
    const target = event.target.closest('.msn-btn, .chat-mini-btn, .win-btn, .chat-tool-btn');
    if (!target) return;

    const rect = target.getBoundingClientRect();
    const ripple = document.createElement('span');
    ripple.className = 'xp-ripple';
    const size = Math.max(rect.width, rect.height) * 1.2;
    ripple.style.width = `${size}px`;
    ripple.style.height = `${size}px`;
    ripple.style.left = `${event.clientX - rect.left - size / 2}px`;
    ripple.style.top = `${event.clientY - rect.top - size / 2}px`;
    target.appendChild(ripple);
    ripple.addEventListener('animationend', () => ripple.remove(), { once: true });
  });
}

function initAeroBubbles() {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  if (document.querySelector('.aero-bubble-layer')) return;

  const layer = document.createElement('div');
  layer.className = 'aero-bubble-layer';
  document.body.appendChild(layer);

  for (let i = 0; i < 8; i += 1) {
    const bubble = document.createElement('div');
    bubble.className = 'aero-bubble';
    const size = 10 + Math.floor(Math.random() * 18);
    bubble.style.width = `${size}px`;
    bubble.style.height = `${size}px`;
    bubble.style.left = `${Math.floor(Math.random() * 96)}%`;
    bubble.style.animationDuration = `${15 + Math.floor(Math.random() * 14)}s`;
    bubble.style.animationDelay = `${Math.floor(Math.random() * 11)}s`;
    layer.appendChild(bubble);
  }
}

function showNetworkBanner(message, tone = 'warn', autoHideMs = 0) {
  const banner = $('network-banner');
  if (!banner) return;
  banner.textContent = message;
  banner.classList.remove('hidden', 'offline', 'warn');
  if (tone === 'offline') banner.classList.add('offline');
  if (tone === 'warn') banner.classList.add('warn');
  clearTimeout(showNetworkBanner._t);
  if (autoHideMs > 0) {
    showNetworkBanner._t = setTimeout(() => banner.classList.add('hidden'), autoHideMs);
  }
}

function hideNetworkBanner() {
  const banner = $('network-banner');
  if (!banner) return;
  banner.classList.add('hidden');
}

function syncResponsiveState() {
  if (isEmbeddedMode) {
    document.body.classList.toggle('embedded-desktop', !isEmbeddedCompact());
  }
  if (!isPaneSwitching()) {
    document.body.classList.remove('mobile-chat-open');
  }
  if (!promptStudioWindow?.classList.contains('hidden') && isPaneSwitching()) {
    document.body.classList.add('mobile-chat-open');
  }
}

function getPromptFields() {
  return {
    brand: $('prompt-brand').value.trim() || 'the brand',
    platform: $('prompt-platform').value.trim() || 'the target platform',
    audience: $('prompt-audience').value.trim() || 'the intended audience',
    tone: $('prompt-tone').value.trim() || 'clear and brand-aligned',
    goal: $('prompt-goal').value.trim() || 'improve engagement and business outcomes',
    language: $('prompt-language').value,
    assetSummary: $('prompt-asset-summary')?.value.trim() || 'No specific asset summary provided.',
    cta: $('prompt-cta')?.value.trim() || 'Use a relevant CTA.',
    responsePriority: $('prompt-response-priority')?.value.trim() || 'Questions, objections, and high-intent comments',
    scheduleWindow: $('prompt-schedule-window')?.value.trim() || 'the next publishing cycle',
    contentMix: $('prompt-content-mix')?.value.trim() || 'a balanced mix of formats',
    campaignContext: $('prompt-campaign-context')?.value.trim() || 'No extra campaign context provided.',
    signal: $('prompt-signal')?.value.trim() || 'General brand chatter',
    riskLevel: $('prompt-risk-level')?.value || 'Moderate',
    sourceNotes: $('prompt-source-notes')?.value.trim() || 'No detailed source notes provided.',
    niche: $('prompt-niche')?.value.trim() || 'relevant creators',
    budget: $('prompt-budget')?.value.trim() || 'flexible budget',
    region: $('prompt-region')?.value.trim() || 'target region not specified',
    selectionCriteria: $('prompt-selection-criteria')?.value.trim() || 'Audience fit, credibility, and performance quality',
    constraints: $('prompt-constraints').value.trim() || 'Keep it on-brand and practical.',
  };
}

function renderPromptOutput(text) {
  $('prompt-output').value = text;
  $('prompt-output-status').textContent = `Generated ${new Date().toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' })}`;
}

function setPromptWorkflow(workflow) {
  const config = PROMPT_WORKFLOWS[workflow] || PROMPT_WORKFLOWS.engagement;
  promptStudioWindow.dataset.workflow = workflow;
  document.querySelectorAll('.prompt-nav-btn').forEach((button) => {
    button.classList.toggle('active', button.dataset.workflow === workflow);
  });
  document.querySelectorAll('[data-workflow-panel]').forEach((panel) => {
    panel.classList.toggle('hidden', panel.dataset.workflowPanel !== workflow);
  });
  $('prompt-studio-title-copy').textContent = config.label;
  $('prompt-studio-description').textContent = config.description;
}

function clearPromptBrief() {
  $('prompt-studio-form').reset();
  setPromptWorkflow('engagement');
  $('prompt-output').value = '';
  $('prompt-output-status').textContent = 'Ready to generate';
}

function applyPromptSeed(seedName) {
  const seed = PROMPT_SEEDS[seedName];
  if (!seed) return;
  clearPromptBrief();
  setPromptWorkflow(seed.workflow);
  Object.entries(seed).forEach(([key, value]) => {
    const field = $(`prompt-${key.replace(/[A-Z]/g, (char) => `-${char.toLowerCase()}`)}`);
    if (!field) return;
    field.value = value;
  });
  renderPromptOutput(PROMPT_WORKFLOWS[seed.workflow].build(getPromptFields()));
}

function openPromptStudio() {
  promptStudioWindow.classList.remove('hidden');
  bumpWindowToFront(promptStudioWindow);
  if (isPaneSwitching()) {
    document.body.classList.add('mobile-chat-open');
  }
}

function closePromptStudio() {
  promptStudioWindow.classList.add('hidden');
  if (isPaneSwitching()) {
    document.body.classList.remove('mobile-chat-open');
  }
}

function setupPromptStudio() {
  if (!promptStudioWindow || setupPromptStudio._ready) return;
  setupPromptStudio._ready = true;
  setPromptWorkflow('engagement');

  $('prompt-studio-toggle').onclick = () => openPromptStudio();
  $('prompt-studio-close').onclick = () => closePromptStudio();
  promptStudioWindow.addEventListener('pointerdown', () => bumpWindowToFront(promptStudioWindow));

  document.querySelectorAll('.prompt-nav-btn').forEach((button) => {
    button.onclick = () => setPromptWorkflow(button.dataset.workflow);
  });

  document.querySelectorAll('.prompt-seed-btn').forEach((button) => {
    button.onclick = () => applyPromptSeed(button.dataset.seed);
  });

  $('prompt-studio-form').addEventListener('submit', (event) => {
    event.preventDefault();
    const workflow = promptStudioWindow.dataset.workflow || 'engagement';
    renderPromptOutput(PROMPT_WORKFLOWS[workflow].build(getPromptFields()));
  });

  $('prompt-reset-btn').onclick = () => clearPromptBrief();
  $('prompt-copy-btn').onclick = async () => {
    const output = $('prompt-output').value.trim();
    if (!output) {
      toast('Generate a prompt before copying');
      return;
    }
    try {
      await navigator.clipboard.writeText(output);
      toast('Copied prompt to clipboard');
    } catch {
      toast('Copy failed');
    }
  };
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

function normalizeSearchText(value) {
  return String(value || '').toLowerCase().trim();
}

function matchesContactSearch(friend) {
  if (!contactSearchQuery) return true;
  const haystack = [friend.display_name, friend.username, friend.msn_id, friend.status_msg]
    .map(normalizeSearchText)
    .join(' ');
  return haystack.includes(contactSearchQuery);
}

function matchesGroupSearch(group) {
  if (!contactSearchQuery) return true;
  const haystack = [group.title, group.last_msg]
    .map(normalizeSearchText)
    .join(' ');
  return haystack.includes(contactSearchQuery);
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
  initAeroBubbles();
  initButtonRipple();
  setupPromptStudio();
  hydrateTooltips(document);
  setProfileFields();
  await Promise.all([loadSettings(), loadWebrtcConfig(), loadFriends(), loadGroups(), loadPendingRequests()]);
  connectSocket();
  await restoreOpenConversations();
  syncResponsiveState();
  window.addEventListener('resize', syncResponsiveState);
  playSound('sign_in');
  setInterval(loadPendingRequests, 30000);
  setInterval(loadGroups, 45000);
}

function activateEmbeddedChat(targetWin) {
  if (!isFixedPaneMode()) return;
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

$('toolbar-logout-btn').onclick = async () => {
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
    if (!matchesContactSearch(friend)) return;
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

const contactSearchInput = $('contact-search-input');
if (contactSearchInput) {
  contactSearchInput.addEventListener('input', (event) => {
    contactSearchQuery = normalizeSearchText(event.target.value);
    renderGroups();
    renderFriends();
  });
}

const refreshContactsBtn = $('refresh-contacts-btn');
if (refreshContactsBtn) {
  refreshContactsBtn.onclick = async () => {
    await Promise.all([loadFriends(), loadGroups(), loadPendingRequests()]);
    toast('รีเฟรชรายชื่อแล้ว');
  };
}

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
    if (!matchesGroupSearch(group)) return;
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
    if (!isFixedPaneMode()) bumpWindowToFront(chatWindows[meta.key]);
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

  if (!isFixedPaneMode()) {
    bumpWindowToFront(win);
    win.addEventListener('pointerdown', () => bumpWindowToFront(win));
  }

  hydrateTooltips(win);

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
    if (isPaneSwitching()) {
      document.body.classList.remove('mobile-chat-open');
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
  win.querySelector('.mobile-back-btn').onclick = () => {
    if (isPaneSwitching()) {
      document.body.classList.remove('mobile-chat-open');
    }
  };

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
  if (!isFixedPaneMode()) {
    makeDraggable(win, win.querySelector('.chat-titlebar'));
  }
  activateEmbeddedChat(win);
  if (isPaneSwitching()) {
    document.body.classList.add('mobile-chat-open');
  }

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

  if (!msg || msg.sender_id === me.id) return;
  if (msg.msg_type === 'nudge') {
    playSound('nudge');
    return;
  }
  playSound('message_in');
}

function connectSocket() {
  socket = io({ auth: { token: '' }, withCredentials: true });

  socket.on('connect', () => {
    showNetworkBanner('Connected', '', 1200);
  });

  socket.on('disconnect', () => {
    showNetworkBanner('Offline mode: trying to reconnect...', 'offline');
  });

  socket.on('connect_error', () => {
    showNetworkBanner('Connection failed. Retrying...', 'offline');
  });

  if (socket.io) {
    socket.io.on('reconnect_attempt', () => {
      showNetworkBanner('Reconnecting...', 'warn');
    });
    socket.io.on('reconnect', () => {
      showNetworkBanner('Reconnected', '', 1200);
    });
  }

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
    const prevStatus = friend.status;
    friend.status = status;
    renderFriends();
    if (status === 'online' && prevStatus !== 'online') playSound('online');
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
    bumpWindowToFront(win);

    function onMove(moveEvent) {
      const maxLeft = Math.max(0, window.innerWidth - rect.width);
      const maxTop = Math.max(0, window.innerHeight - rect.height);
      let nextLeft = Math.min(maxLeft, Math.max(0, moveEvent.clientX - ox));
      let nextTop = Math.min(maxTop, Math.max(0, moveEvent.clientY - oy));

      if (nextLeft <= WINDOW_SNAP_PX) nextLeft = 0;
      if (nextTop <= WINDOW_SNAP_PX) nextTop = 0;
      if (maxLeft - nextLeft <= WINDOW_SNAP_PX) nextLeft = maxLeft;
      if (maxTop - nextTop <= WINDOW_SNAP_PX) nextTop = maxTop;

      win.style.left = `${nextLeft}px`;
      win.style.top = `${nextTop}px`;
    }

    function onUp() {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    }

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  });
}

if (!isFixedPaneMode()) {
  makeDraggable($('buddy-window'), $('buddy-window').querySelector('.msn-titlebar'));
  if (promptStudioWindow) makeDraggable(promptStudioWindow, promptStudioWindow.querySelector('.prompt-studio-titlebar'));
}

init();