const express = require('express');
const auth = require('../middleware/auth');
const { getIceServers } = require('../controllers/webrtcController');

const router = express.Router();

router.get('/ice-servers', auth, getIceServers);

module.exports = router;

