'use strict';

const Redis = require('ioredis');

const redisUrl = process.env.REDIS_URL;
const memoryBuckets = new Map();

const redis = redisUrl ? new Redis(redisUrl, {
  maxRetriesPerRequest: 1,
  enableOfflineQueue: false,
  lazyConnect: true,
}) : null;

let redisReady = false;
if (redis) {
  redis.connect().then(() => {
    redisReady = true;
  }).catch((error) => {
    console.error('rateLimit redis connect error', error);
  });

  redis.on('error', (error) => {
    redisReady = false;
    console.error('rateLimit redis error', error);
  });

  redis.on('ready', () => {
    redisReady = true;
  });
} else {
  console.warn('rateLimit: REDIS_URL is not set, using in-memory limiter fallback');
}

function memoryRateLimit({ key, limit, windowMs, message }) {
  return (req, res, next) => {
    const subject = `${key}:${req.ip || 'unknown'}`;
    const now = Date.now();
    const entry = memoryBuckets.get(subject);

    if (!entry || entry.resetAt <= now) {
      memoryBuckets.set(subject, { count: 1, resetAt: now + windowMs });
      return next();
    }

    if (entry.count >= limit) {
      return res.status(429).json({ error: message });
    }

    entry.count += 1;
    return next();
  };
}

function rateLimit({ key = 'default', limit = 30, windowMs = 60_000, message = 'คำขอถี่เกินไป กรุณาลองใหม่อีกครั้ง' }) {
  const fallbackLimiter = memoryRateLimit({ key, limit, windowMs, message });

  return async (req, res, next) => {
    if (!redis || !redisReady) {
      return fallbackLimiter(req, res, next);
    }

    const subject = `${key}:${req.ip || 'unknown'}`;
    const bucket = Math.floor(Date.now() / windowMs);
    const redisKey = `rl:${subject}:${bucket}`;

    try {
      const count = await redis.incr(redisKey);
      if (count === 1) {
        await redis.pexpire(redisKey, windowMs);
      }

      if (count > limit) {
        return res.status(429).json({ error: message });
      }

      return next();
    } catch (error) {
      console.error('rateLimit redis op error', error);
      return fallbackLimiter(req, res, next);
    }
  };
}

module.exports = rateLimit;
