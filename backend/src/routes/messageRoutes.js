const express = require('express');
const { getMessages, createMessage } = require('../controllers/messageController');
const auth = require('../middleware/auth');

const router = express.Router();

router.get('/', auth, getMessages);
router.post('/', auth, createMessage);

module.exports = router;

