const express = require('express');
const {
  getMessages,
  createMessage,
  createVoiceMessage,
  createImageMessage,
  markMessagesSeen,
} = require('../controllers/messageController');
const auth = require('../middleware/auth');

const router = express.Router();

const voiceUploadLimit = parseInt(process.env.VOICE_UPLOAD_MAX_SIZE || '', 10);
const voiceBodyParser = express.raw({
  type: ['audio/webm', 'audio/ogg', 'audio/mpeg', 'audio/mp3', 'audio/wav', 'audio/*', 'application/octet-stream'],
  limit: Number.isNaN(voiceUploadLimit) ? 10 * 1024 * 1024 : voiceUploadLimit,
});

const imageUploadLimit = parseInt(process.env.IMAGE_UPLOAD_MAX_SIZE || '', 10);
const imageBodyParser = express.raw({
  type: ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp', 'image/*', 'application/octet-stream'],
  limit: Number.isNaN(imageUploadLimit) ? 10 * 1024 * 1024 : imageUploadLimit,
});

router.get('/', auth, getMessages);
router.post('/', auth, createMessage);
router.post('/voice', auth, voiceBodyParser, createVoiceMessage);
router.post('/image', auth, imageBodyParser, createImageMessage);
router.post('/seen', auth, markMessagesSeen);

// Debug route to verify registration
console.log('[messageRoutes] Routes registered:');
console.log('  GET  /api/messages');
console.log('  POST /api/messages');
console.log('  POST /api/messages/voice');
console.log('  POST /api/messages/image');
console.log('  POST /api/messages/seen');

module.exports = router;

