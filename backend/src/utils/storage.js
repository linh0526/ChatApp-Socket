const fs = require('fs');
const fsPromises = require('fs/promises');
const path = require('path');
const { randomUUID } = require('crypto');
const mime = require('mime-types');

const uploadsRoot = path.join(__dirname, '..', '..', 'uploads');
const voiceRoot = path.join(uploadsRoot, 'voice');
const imageRoot = path.join(uploadsRoot, 'images');

const ensureDirSync = (dirPath) => {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
};

ensureDirSync(uploadsRoot);
ensureDirSync(voiceRoot);
ensureDirSync(imageRoot);

const normalizeSegment = (segment) =>
  String(segment || '')
    .trim()
    .replace(/[^a-zA-Z0-9-_]/g, '_') || 'anonymous';

const storeBinaryAsset = async ({ rootDir, userId, buffer, mimeType, originalName, fallbackExt }) => {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
    throw new Error('Invalid binary buffer provided');
  }

  const safeUserId = normalizeSegment(userId || 'anonymous');
  const userDir = path.join(rootDir, safeUserId);
  ensureDirSync(userDir);

  const extensionFromMime = mime.extension(mimeType || '') || null;
  const extensionFromName = originalName ? path.extname(originalName).replace(/^\./, '') : null;
  const extension = extensionFromMime || extensionFromName || fallbackExt || 'bin';
  const safeExtension = extension.startsWith('.') ? extension.slice(1) : extension;

  const fileName = `${Date.now()}-${randomUUID()}.${safeExtension}`;
  const absolutePath = path.join(userDir, fileName);
  await fsPromises.writeFile(absolutePath, buffer);

  const relativePath = path
    .join(path.basename(rootDir), safeUserId, fileName)
    .split(path.sep)
    .join('/');

  return {
    fileName,
    originalName: originalName || fileName,
    mimeType,
    size: buffer.length,
    storagePath: absolutePath,
    relativePath,
    url: `/uploads/${relativePath}`,
  };
};

const storeVoiceRecording = async ({ buffer, mimeType, originalName, userId }) => {
  const stored = await storeBinaryAsset({
    rootDir: voiceRoot,
    userId,
    buffer,
    mimeType: mimeType || 'audio/webm',
    originalName,
    fallbackExt: 'webm',
  });

  if (!stored.mimeType) {
    stored.mimeType = 'audio/webm';
  }

  return stored;
};

const storeImageFile = async ({ buffer, mimeType, originalName, userId }) => {
  const stored = await storeBinaryAsset({
    rootDir: imageRoot,
    userId,
    buffer,
    mimeType: mimeType || 'image/jpeg',
    originalName,
    fallbackExt: 'jpg',
  });

  if (!stored.mimeType) {
    stored.mimeType = 'image/jpeg';
  }

  return stored;
};

module.exports = {
  uploadsRoot,
  voiceRoot,
  imageRoot,
  ensureDirSync,
  storeVoiceRecording,
  storeImageFile,
};

