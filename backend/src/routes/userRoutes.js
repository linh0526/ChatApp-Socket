const express = require('express');
const { searchUsers, getOnlineUsers } = require('../controllers/userController');
const auth = require('../middleware/auth');

const router = express.Router();

router.get('/search', auth, searchUsers);
router.get('/online', auth, getOnlineUsers);

module.exports = router;


