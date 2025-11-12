const User = require('../models/User');

const normalizeUser = (user) => ({
  id: user._id.toString(),
  username: user.username,
  email: user.email,
});

exports.searchUsers = async (req, res) => {
  try {
    const userId = req.user.id;
    const query = String(req.query.q || req.query.query || '').trim();

    if (!query) {
      return res.json({ results: [] });
    }

    const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(escaped, 'i');

    const currentUser = await User.findById(userId).select('friends').lean();
    if (!currentUser) {
      return res.status(404).json({ error: 'User not found' });
    }
    const friendIds = new Set((currentUser.friends ?? []).map((id) => id.toString()));

    const results = await User.find({
      _id: { $ne: userId },
      $or: [{ username: regex }, { email: regex }],
    })
      .select('username email')
      .limit(10)
      .lean();

    const filtered = results.filter((user) => !friendIds.has(user._id.toString()));

    return res.json({
      results: filtered.map(normalizeUser),
    });
  } catch (error) {
    console.error('searchUsers error:', error);
    return res.status(500).json({ error: 'Không thể tìm kiếm người dùng' });
  }
};


