'use strict';

const buckets = new Map();

function rateLimit({ key = 'default', limit = 30, windowMs = 60_000, message = 'คำขอถี่เกินไป กรุณาลองใหม่อีกครั้ง' }) {
  return (req, res, next) => {
    const subject = `${key}:${req.ip || 'unknown'}`;
    const now = Date.now();
    const entry = buckets.get(subject);

    if (!entry || entry.resetAt <= now) {
      buckets.set(subject, { count: 1, resetAt: now + windowMs });
      return next();
    }

    if (entry.count >= limit) {
      return res.status(429).json({ error: message });
    }

    entry.count += 1;
    return next();
  };
}

module.exports = rateLimit;
