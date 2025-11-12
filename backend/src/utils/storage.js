const fs = require('fs');
const fsPromises = require('fs/promises');
const path = require('path');
const { randomUUID } = require('crypto');
const mime = require('mime-types');

const uploadsRoot = path.join(__dirname, '..', '..', 'uploads');
const voiceRoot = path.join(uploadsRoot, 'voice');

const ensureDirSync = (dirPath) => {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
};

ensureDirSync(uploadsRoot);
ensureDirSync(voiceRoot);

const normalizeSegment = (segment) =>
  String(segment || '')
    .trim()
    .replace(/[^a-zA-Z0-9-_]/g, '_') || 'anonymous';

const storeVoiceRecording = async ({ buffer, mimeType, originalName, userId }) => {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
    throw new Error('Invalid audio buffer provided');
  }

  const safeUserId = normalizeSegment(userId);
  const userDir = path.join(voiceRoot, safeUserId);
  ensureDirSync(userDir);

  const extensionFromMime = mime.extension(mimeType || '') || null;
  const extensionFromName = originalName ? path.extname(originalName).replace(/^\./, '') : null;
  const extension = extensionFromMime || extensionFromName || 'webm';
  const safeExtension = extension.startsWith('.') ? extension.slice(1) : extension;

  const fileName = `${Date.now()}-${randomUUID()}.${safeExtension}`;
  const absolutePath = path.join(userDir, fileName);
  await fsPromises.writeFile(absolutePath, buffer);

  const relativePath = path
    .join('voice', safeUserId, fileName)
    .split(path.sep)
    .join('/');

  return {
    fileName,
    originalName: originalName || fileName,
    mimeType: mimeType || 'audio/webm',
    size: buffer.length,
    storagePath: absolutePath,
    relativePath,
    url: `/uploads/${relativePath}`,
  };
};

module.exports = {
  uploadsRoot,
  voiceRoot,
  ensureDirSync,
  storeVoiceRecording,
};

