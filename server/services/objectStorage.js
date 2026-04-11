'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

let s3Client;
let PutObjectCommand;

const provider = (process.env.OBJECT_STORAGE_PROVIDER || '').toLowerCase();
const useS3 = provider === 's3';

if (useS3) {
  ({ S3Client: s3Client, PutObjectCommand } = require('@aws-sdk/client-s3'));
}

const LOCAL_ROOT = process.env.LOCAL_STORAGE_PATH || path.join(__dirname, '../../data/uploads');

if (!useS3 && !fs.existsSync(LOCAL_ROOT)) {
  fs.mkdirSync(LOCAL_ROOT, { recursive: true });
}

function sanitizeFileName(fileName) {
  return String(fileName || 'file')
    .replace(/[^a-zA-Z0-9._-]/g, '_')
    .slice(0, 120);
}

function parseDataUrl(dataUrl) {
  const m = String(dataUrl || '').match(/^data:([\w.+-]+\/[\w.+-]+);base64,(.+)$/);
  if (!m) {
    throw new Error('รูปแบบไฟล์แนบไม่ถูกต้อง');
  }
  return {
    mimeType: m[1],
    buffer: Buffer.from(m[2], 'base64'),
  };
}

async function uploadToLocal({ fileName, mimeType, dataUrl }) {
  const { buffer } = parseDataUrl(dataUrl);
  const ext = path.extname(fileName) || '';
  const key = `${Date.now()}-${crypto.randomUUID()}${ext}`;
  const fullPath = path.join(LOCAL_ROOT, key);
  fs.writeFileSync(fullPath, buffer);

  return {
    key,
    url: `/uploads/${key}`,
    size: buffer.length,
    contentType: mimeType,
  };
}

async function uploadToS3({ fileName, mimeType, dataUrl }) {
  const { buffer } = parseDataUrl(dataUrl);
  const ext = path.extname(fileName) || '';
  const key = `${process.env.OBJECT_STORAGE_PREFIX || 'attachments'}/${Date.now()}-${crypto.randomUUID()}${ext}`;

  const client = new s3Client({
    region: process.env.OBJECT_STORAGE_REGION,
    endpoint: process.env.OBJECT_STORAGE_ENDPOINT || undefined,
    forcePathStyle: String(process.env.OBJECT_STORAGE_FORCE_PATH_STYLE || 'false') === 'true',
    credentials: {
      accessKeyId: process.env.OBJECT_STORAGE_ACCESS_KEY,
      secretAccessKey: process.env.OBJECT_STORAGE_SECRET_KEY,
    },
  });

  await client.send(new PutObjectCommand({
    Bucket: process.env.OBJECT_STORAGE_BUCKET,
    Key: key,
    Body: buffer,
    ContentType: mimeType,
  }));

  const publicBase = process.env.OBJECT_STORAGE_PUBLIC_BASE_URL;
  if (!publicBase) {
    throw new Error('OBJECT_STORAGE_PUBLIC_BASE_URL is required for S3 provider');
  }

  return {
    key,
    url: `${publicBase.replace(/\/$/, '')}/${encodeURIComponent(key).replace(/%2F/g, '/')}`,
    size: buffer.length,
    contentType: mimeType,
  };
}

async function uploadAttachment(attachment) {
  if (!attachment) return null;

  const fileName = sanitizeFileName(attachment.name);
  const mimeType = String(attachment.type || 'application/octet-stream');
  const dataUrl = String(attachment.data || '');

  if (useS3) {
    const stored = await uploadToS3({ fileName, mimeType, dataUrl });
    return { ...stored, fileName };
  }

  const stored = await uploadToLocal({ fileName, mimeType, dataUrl });
  return { ...stored, fileName };
}

module.exports = {
  uploadAttachment,
};
