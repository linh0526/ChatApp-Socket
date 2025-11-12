const FriendRequest = require('../models/FriendRequest');
const User = require('../models/User');

const normalizeUser = (user) => ({
  id: user._id.toString(),
  username: user.username,
  email: user.email,
});

const mapRequest = (request, direction) => ({
  id: request._id.toString(),
  status: request.status,
  createdAt: request.createdAt,
  respondedAt: request.respondedAt,
  direction,
  user:
    direction === 'incoming'
      ? normalizeUser(request.from)
      : normalizeUser(request.to),
});

exports.listFriends = async (req, res) => {
  try {
    const user = await User.findById(req.user.id)
      .populate('friends', 'username email')
      .lean();
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    const friends = (user.friends ?? []).map(normalizeUser);
    return res.json({ friends });
  } catch (error) {
    console.error('listFriends error:', error);
    return res.status(500).json({ error: 'Failed to load friends' });
  }
};

exports.listRequests = async (req, res) => {
  try {
    const userId = req.user.id;
    const [incoming, outgoing] = await Promise.all([
      FriendRequest.find({ to: userId, status: 'pending' })
        .populate('from', 'username email')
        .populate('to', 'username email')
        .sort({ createdAt: -1 })
        .lean(),
      FriendRequest.find({ from: userId, status: 'pending' })
        .populate('from', 'username email')
        .populate('to', 'username email')
        .sort({ createdAt: -1 })
        .lean(),
    ]);

    return res.json({
      incoming: incoming.map((item) => mapRequest(item, 'incoming')),
      outgoing: outgoing.map((item) => mapRequest(item, 'outgoing')),
    });
  } catch (error) {
    console.error('listRequests error:', error);
    return res.status(500).json({ error: 'Failed to load friend requests' });
  }
};

exports.sendRequest = async (req, res) => {
  try {
    const userId = req.user.id;
    const { targetId, targetUsername, targetEmail } = req.body || {};

    if (!targetId && !targetUsername && !targetEmail) {
      return res
        .status(400)
        .json({ error: 'targetId, targetUsername, or targetEmail is required' });
    }

    let targetQuery = null;
    if (targetId) {
      targetQuery = { _id: targetId };
    } else if (targetUsername) {
      targetQuery = { username: String(targetUsername).trim() };
    } else if (targetEmail) {
      targetQuery = { email: String(targetEmail).trim().toLowerCase() };
    }

    const [currentUser, targetUser] = await Promise.all([
      User.findById(userId).select('friends username email'),
      targetQuery ? User.findOne(targetQuery).select('username email friends') : null,
    ]);

    if (!currentUser) {
      return res.status(404).json({ error: 'User not found' });
    }

    if (!targetUser) {
      return res.status(404).json({ error: 'Người dùng không tồn tại' });
    }

    const targetUserId = targetUser._id.toString();
    if (targetUserId === userId) {
      return res.status(400).json({ error: 'Không thể kết bạn với chính mình' });
    }

    const alreadyFriends = (currentUser.friends ?? []).some(
      (friendId) => friendId.toString() === targetUserId
    );
    if (alreadyFriends) {
      return res.status(409).json({ error: 'Hai bạn đã là bạn bè' });
    }

    const reverseRequest = await FriendRequest.findOne({
      from: targetUserId,
      to: userId,
    });

    if (reverseRequest && reverseRequest.status === 'pending') {
      reverseRequest.status = 'accepted';
      reverseRequest.respondedAt = new Date();
      await reverseRequest.save();
      await Promise.all([
        User.findByIdAndUpdate(userId, { $addToSet: { friends: targetUserId } }),
        User.findByIdAndUpdate(targetUserId, { $addToSet: { friends: userId } }),
      ]);

      return res.status(200).json({
        message: 'Lời mời kết bạn đã được chấp nhận tự động',
        friend: normalizeUser(targetUser),
        request: mapRequest(reverseRequest, 'incoming'),
      });
    }

    const existingRequest = await FriendRequest.findOne({
      from: userId,
      to: targetUserId,
    });

    if (existingRequest) {
      if (existingRequest.status === 'pending') {
        return res.status(409).json({ error: 'Bạn đã gửi lời mời trước đó' });
      }

      existingRequest.status = 'pending';
      existingRequest.respondedAt = null;
      existingRequest.createdAt = new Date();
      await existingRequest.save();

      return res.status(200).json({
        message: 'Đã gửi lại lời mời kết bạn',
        request: mapRequest(existingRequest, 'outgoing'),
      });
    }

    const request = await FriendRequest.create({
      from: userId,
      to: targetUserId,
      status: 'pending',
    });

    const populated = await request.populate([
      { path: 'from', select: 'username email' },
      { path: 'to', select: 'username email' },
    ]);

    return res.status(201).json({
      message: 'Đã gửi lời mời kết bạn',
      request: mapRequest(populated, 'outgoing'),
    });
  } catch (error) {
    if (error.code === 11000) {
      return res.status(409).json({ error: 'Bạn đã gửi lời mời trước đó' });
    }
    console.error('sendRequest error:', error);
    return res.status(500).json({ error: 'Không thể gửi lời mời' });
  }
};

exports.respondRequest = async (req, res) => {
  try {
    const userId = req.user.id;
    const { requestId } = req.params;
    const { action } = req.body || {};

    if (!['accept', 'decline'].includes(action)) {
      return res.status(400).json({ error: 'Hành động không hợp lệ' });
    }

    const request = await FriendRequest.findById(requestId)
      .populate('from', 'username email')
      .populate('to', 'username email');

    if (!request || request.to._id.toString() !== userId) {
      return res.status(404).json({ error: 'Lời mời không tồn tại' });
    }

    if (request.status !== 'pending') {
      return res.status(400).json({ error: 'Lời mời đã được xử lý' });
    }

    request.respondedAt = new Date();

    if (action === 'accept') {
      request.status = 'accepted';
      await request.save();
      await Promise.all([
        User.findByIdAndUpdate(userId, { $addToSet: { friends: request.from._id } }),
        User.findByIdAndUpdate(request.from._id, { $addToSet: { friends: userId } }),
      ]);

      return res.json({
        message: 'Đã chấp nhận lời mời kết bạn',
        friend: normalizeUser(request.from),
        request: mapRequest(request, 'incoming'),
      });
    }

    request.status = 'declined';
    await request.save();

    return res.json({
      message: 'Đã từ chối lời mời kết bạn',
      request: mapRequest(request, 'incoming'),
    });
  } catch (error) {
    console.error('respondRequest error:', error);
    return res.status(500).json({ error: 'Không thể xử lý lời mời' });
  }
};

exports.cancelRequest = async (req, res) => {
  try {
    const userId = req.user.id;
    const { requestId } = req.params;

    const request = await FriendRequest.findById(requestId)
      .populate('from', 'username email')
      .populate('to', 'username email');

    if (!request || request.from._id.toString() !== userId) {
      return res.status(404).json({ error: 'Lời mời không tồn tại' });
    }

    if (request.status !== 'pending') {
      return res.status(400).json({ error: 'Không thể huỷ lời mời đã xử lý' });
    }

    request.status = 'cancelled';
    request.respondedAt = new Date();
    await request.save();

    return res.json({
      message: 'Đã huỷ lời mời kết bạn',
      request: mapRequest(request, 'outgoing'),
    });
  } catch (error) {
    console.error('cancelRequest error:', error);
    return res.status(500).json({ error: 'Không thể huỷ lời mời' });
  }
};


