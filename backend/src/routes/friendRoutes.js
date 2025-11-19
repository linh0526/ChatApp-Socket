const express = require('express');
const {
  listFriends,
  listRequests,
  sendRequest,
  respondRequest,
  cancelRequest,
  removeFriend,
} = require('../controllers/friendController');
const auth = require('../middleware/auth');

const router = express.Router();

router.get('/', auth, listFriends);
router.get('/requests', auth, listRequests);
router.post('/requests', auth, sendRequest);
router.post('/requests/:requestId/respond', auth, respondRequest);
router.post('/requests/:requestId/cancel', auth, cancelRequest);
router.delete('/:friendId', auth, removeFriend);

module.exports = router;


