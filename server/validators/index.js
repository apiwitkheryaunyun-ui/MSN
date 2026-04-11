'use strict';

const VALID_STATUSES = ['online', 'away', 'busy', 'be right back', 'appear offline'];
const VALID_MESSAGE_TYPES = ['text', 'nudge', 'wink', 'file'];
const VALID_THEMES = ['classic', 'olive', 'silver'];
const VALID_PRIVACY_MODES = ['everyone', 'contacts-only'];

function isValidEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || ''));
}

function isValidUsername(value) {
  return /^[a-zA-Z0-9_]{3,30}$/.test(String(value || ''));
}

function isValidMsnId(value) {
  return /^\d{10}$/.test(String(value || ''));
}

function sanitizeText(value, maxLength = 4000) {
  return String(value || '').trim().slice(0, maxLength);
}

function sanitizeDisplayName(value) {
  return sanitizeText(value, 50);
}

function sanitizeStatusMessage(value) {
  return sanitizeText(value, 140);
}

function sanitizeConversationTitle(value) {
  return sanitizeText(value, 50);
}

function isValidStatus(value) {
  return VALID_STATUSES.includes(value);
}

function isValidMessageType(value) {
  return VALID_MESSAGE_TYPES.includes(value);
}

function isValidTheme(value) {
  return VALID_THEMES.includes(value);
}

function isValidPrivacyMode(value) {
  return VALID_PRIVACY_MODES.includes(value);
}

function normalizeBoolean(value) {
  return value ? 1 : 0;
}

function validateAttachment(attachment) {
  if (!attachment) return { ok: true };

  const name = sanitizeText(attachment.name, 120);
  const mime = sanitizeText(attachment.type, 80);
  const data = String(attachment.data || '');
  const size = Number(attachment.size || 0);

  if (!name || !data) {
    return { ok: false, error: 'ไฟล์แนบไม่สมบูรณ์' };
  }
  if (!/^data:[\w.+-]+\/[\w.+-]+;base64,/.test(data)) {
    return { ok: false, error: 'รูปแบบไฟล์แนบไม่ถูกต้อง' };
  }
  if (size <= 0 || size > 1024 * 1024) {
    return { ok: false, error: 'ไฟล์ต้องมีขนาดไม่เกิน 1MB' };
  }

  return {
    ok: true,
    attachment: {
      name,
      type: mime || 'application/octet-stream',
      size,
      data: data.slice(0, 1600000)
    }
  };
}

module.exports = {
  VALID_STATUSES,
  VALID_MESSAGE_TYPES,
  VALID_THEMES,
  VALID_PRIVACY_MODES,
  isValidEmail,
  isValidUsername,
  isValidMsnId,
  sanitizeText,
  sanitizeDisplayName,
  sanitizeStatusMessage,
  sanitizeConversationTitle,
  isValidStatus,
  isValidMessageType,
  isValidTheme,
  isValidPrivacyMode,
  normalizeBoolean,
  validateAttachment,
};
