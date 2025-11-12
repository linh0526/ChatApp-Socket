const express = require('express');
const { searchUsers } = require('../controllers/userController');
const auth = require('../middleware/auth');

const router = express.Router();

router.get('/search', auth, searchUsers);

module.exports = router;


