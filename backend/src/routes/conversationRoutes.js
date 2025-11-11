const express = require('express');
const auth = require('../middleware/auth');
const {
  listMyConversations,
  createDirectConversation,
  createGroupConversation,
} = require('../controllers/conversationController');

const router = express.Router();

router.get('/', auth, listMyConversations);
router.post('/direct', auth, createDirectConversation);
router.post('/group', auth, createGroupConversation);

module.exports = router;


