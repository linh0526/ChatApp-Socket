const Conversation = require('../models/Conversation');
const User = require('../models/User');

exports.listMyConversations = async (req, res) => {
  try {
    const userId = req.user.id;
    const conversations = await Conversation.find({ participants: userId })
      .sort({ updatedAt: -1 })
      .lean();
    return res.json(conversations);
  } catch (err) {
    console.error('listMyConversations error:', err);
    return res.status(500).json({ error: 'Failed to list conversations' });
  }
};

exports.createDirectConversation = async (req, res) => {
  try {
    const userId = req.user.id;
    const { friendId } = req.body || {};
    if (!friendId) return res.status(400).json({ error: 'friendId is required' });
    if (friendId === userId) return res.status(400).json({ error: 'Cannot chat with yourself' });

    const friend = await User.findById(friendId);
    if (!friend) return res.status(404).json({ error: 'Friend not found' });

    let convo = await Conversation.findOne({
      isGroup: false,
      participants: { $all: [userId, friendId], $size: 2 },
    });
    if (!convo) {
      convo = await Conversation.create({
        isGroup: false,
        participants: [userId, friendId],
      });
    }
    return res.status(201).json(convo);
  } catch (err) {
    console.error('createDirectConversation error:', err);
    return res.status(500).json({ error: 'Failed to create conversation' });
  }
};

exports.createGroupConversation = async (req, res) => {
  try {
    const userId = req.user.id;
    const { name, memberIds } = req.body || {};
    if (!name || !Array.isArray(memberIds) || memberIds.length < 1) {
      return res.status(400).json({ error: 'name and memberIds (>=1) are required' });
    }
    const uniqueMembers = [...new Set([userId, ...memberIds])];
    const convo = await Conversation.create({
      name: String(name).trim(),
      isGroup: true,
      participants: uniqueMembers,
    });
    return res.status(201).json(convo);
  } catch (err) {
    console.error('createGroupConversation error:', err);
    return res.status(500).json({ error: 'Failed to create group' });
  }
};


