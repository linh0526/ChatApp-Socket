const express = require('express');
const auth = require('../middleware/auth');
const {
  listMyConversations,
  createDirectConversation,
  createGroupConversation,
  archiveConversation,
  unarchiveConversation,
  deleteConversation,
  leaveConversation,
  addConversationMembers,
} = require('../controllers/conversationController');

const router = express.Router();

router.get('/', auth, listMyConversations);
router.post('/direct', auth, createDirectConversation);
router.post('/group', auth, createGroupConversation);
router.post('/:conversationId/archive', auth, archiveConversation);
router.delete('/:conversationId/archive', auth, unarchiveConversation);
router.delete('/:conversationId', auth, deleteConversation);
router.post('/:conversationId/leave', auth, leaveConversation);
router.post('/:conversationId/members', auth, addConversationMembers);

module.exports = router;


