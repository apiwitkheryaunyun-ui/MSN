'use strict';

const Redis = require('ioredis');

const redisUrl = process.env.REDIS_URL;
if (process.env.NODE_ENV === 'production' && !redisUrl) {
  throw new Error('REDIS_URL is required in production for rate limiting');
}

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
}

function rateLimit({ key = 'default', limit = 30, windowMs = 60_000, message = 'คำขอถี่เกินไป กรุณาลองใหม่อีกครั้ง' }) {
  return async (req, res, next) => {
    if (!redis || !redisReady) {
      if (process.env.NODE_ENV === 'production') {
        return res.status(503).json({ error: 'Rate limit backend unavailable' });
      }
      return next();
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
      if (process.env.NODE_ENV === 'production') {
        return res.status(503).json({ error: 'Rate limit backend unavailable' });
      }
      return next();
    }
  };
}

module.exports = rateLimit;
