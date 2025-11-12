const crypto = require('crypto');

const ALGORITHM = 'aes-256-gcm';
const FALLBACK_SECRET = 'dev_message_encryption_key_change_me';

const getKey = () => {
  const secret = process.env.MESSAGE_ENCRYPTION_KEY || FALLBACK_SECRET;
  return crypto.createHash('sha256').update(String(secret), 'utf8').digest();
};

const encryptText = (plainText) => {
  if (typeof plainText !== 'string') {
    throw new TypeError('encryptText expects a string input');
  }

  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGORITHM, getKey(), iv);
  const encrypted = Buffer.concat([cipher.update(plainText, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return [
    iv.toString('base64'),
    authTag.toString('base64'),
    encrypted.toString('base64'),
  ].join(':');
};

const decryptText = (cipherText) => {
  if (typeof cipherText !== 'string') {
    throw new TypeError('decryptText expects a string input');
  }

  const parts = cipherText.split(':');
  if (parts.length !== 3) {
    throw new Error('Invalid cipher text format');
  }

  const [ivB64, authTagB64, encryptedB64] = parts;
  const iv = Buffer.from(ivB64, 'base64');
  const authTag = Buffer.from(authTagB64, 'base64');
  const encrypted = Buffer.from(encryptedB64, 'base64');

  const decipher = crypto.createDecipheriv(ALGORITHM, getKey(), iv);
  decipher.setAuthTag(authTag);
  const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);

  return decrypted.toString('utf8');
};

module.exports = {
  encryptText,
  decryptText,
};

