const express = require('express');
const {
  getMessages,
  createMessage,
  createVoiceMessage,
} = require('../controllers/messageController');
const auth = require('../middleware/auth');

const router = express.Router();

const voiceUploadLimit = parseInt(process.env.VOICE_UPLOAD_MAX_SIZE || '', 10);
const voiceBodyParser = express.raw({
  type: ['audio/webm', 'audio/ogg', 'audio/mpeg', 'audio/mp3', 'audio/wav', 'audio/*', 'application/octet-stream'],
  limit: Number.isNaN(voiceUploadLimit) ? 10 * 1024 * 1024 : voiceUploadLimit,
});

router.get('/', auth, getMessages);
router.post('/', auth, createMessage);
router.post('/voice', auth, voiceBodyParser, createVoiceMessage);

module.exports = router;

