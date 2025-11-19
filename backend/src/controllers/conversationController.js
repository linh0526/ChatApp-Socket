const Conversation = require('../models/Conversation');
const User = require('../models/User');
const Message = require('../models/Message');

const normalizeObjectId = (value) => {
  if (!value) {
    return '';
  }
  if (typeof value === 'string') {
    return value;
  }
  if (typeof value.toString === 'function') {
    return value.toString();
  }
  return String(value);
};

const serializeConversation = (conversation, userId) => {
  if (!conversation) {
    return null;
  }
  const payload =
    typeof conversation.toObject === 'function'
      ? conversation.toObject()
      : { ...conversation };

  const archivedEntry = (payload.archivedBy ?? []).find(
    (entry) => normalizeObjectId(entry?.user) === userId
  );

  const participants = (payload.participants ?? []).map((participant) => {
    if (!participant) {
      return participant;
    }
    const participantId =
      participant.id ?? participant._id ?? normalizeObjectId(participant);

    return {
      id: normalizeObjectId(participantId),
      username: participant.username,
      email: participant.email,
    };
  });

  delete payload.archivedBy;
  delete payload.blockedParticipants;

  return {
    ...payload,
    participants,
    isArchived: Boolean(archivedEntry),
    archivedAt: archivedEntry?.archivedAt ?? null,
  };
};

exports.listMyConversations = async (req, res) => {
  try {
    const userId = req.user.id;
    const includeArchived = String(req.query?.archived).toLowerCase() === 'true';

    const conversations = await Conversation.find({ participants: userId })
      .sort({ updatedAt: -1 })
      .populate('participants', 'username email')
      .lean();

    const filtered = conversations.filter((conversation) => {
      const archivedEntry = (conversation.archivedBy ?? []).find(
        (entry) => normalizeObjectId(entry?.user) === userId
      );
      return includeArchived ? Boolean(archivedEntry) : !archivedEntry;
    });

    const serialized = filtered
      .map((conversation) => serializeConversation(conversation, userId))
      .filter(Boolean);

    return res.json(serialized);
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

    const [currentUser, friend] = await Promise.all([
      User.findById(userId).select('friends'),
      User.findById(friendId),
    ]);
    if (!currentUser) return res.status(404).json({ error: 'User not found' });
    if (!friend) return res.status(404).json({ error: 'Friend not found' });

    const isFriend = (currentUser.friends ?? []).some(
      (existingId) => existingId.toString() === friendId
    );
    if (!isFriend) {
      return res.status(403).json({ error: 'Bạn chỉ có thể nhắn với bạn bè' });
    }

    let convo = await Conversation.findOne({
      isGroup: false,
      participants: { $all: [userId, friendId], $size: 2 },
    })
      .populate('participants', 'username email');

    let created = false;
    if (!convo) {
      created = true;
      convo = await Conversation.create({
        isGroup: false,
        participants: [userId, friendId],
      });
      convo = await convo.populate('participants', 'username email');
    }
    const payload = typeof convo.toObject === 'function' ? convo.toObject() : convo;
    return res.status(created ? 201 : 200).json(payload);
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

exports.archiveConversation = async (req, res) => {
  try {
    const { conversationId } = req.params || {};
    if (!conversationId) {
      return res.status(400).json({ error: 'conversationId is required' });
    }

    const userId = req.user.id;
    const conversation = await Conversation.findOne({
      _id: conversationId,
      participants: userId,
    }).populate('participants', 'username email');

    if (!conversation) {
      return res.status(404).json({ error: 'Conversation not found' });
    }

    const alreadyArchived = (conversation.archivedBy ?? []).some(
      (entry) => normalizeObjectId(entry?.user) === userId
    );

    if (!alreadyArchived) {
      conversation.archivedBy.push({ user: userId, archivedAt: new Date() });
      await conversation.save();
    }

    const payload = serializeConversation(conversation, userId);
    return res.json(payload);
  } catch (err) {
    console.error('archiveConversation error:', err);
    return res.status(500).json({ error: 'Không thể lưu trữ cuộc trò chuyện' });
  }
};

exports.unarchiveConversation = async (req, res) => {
  try {
    const { conversationId } = req.params || {};
    if (!conversationId) {
      return res.status(400).json({ error: 'conversationId is required' });
    }

    const userId = req.user.id;
    const conversation = await Conversation.findOne({
      _id: conversationId,
      participants: userId,
    }).populate('participants', 'username email');

    if (!conversation) {
      return res.status(404).json({ error: 'Conversation not found' });
    }

    const beforeLength = conversation.archivedBy?.length ?? 0;
    conversation.archivedBy = (conversation.archivedBy ?? []).filter(
      (entry) => normalizeObjectId(entry?.user) !== userId
    );

    if (conversation.archivedBy.length !== beforeLength) {
      conversation.markModified('archivedBy');
      await conversation.save();
    }

    const payload = serializeConversation(conversation, userId);
    return res.json(payload);
  } catch (err) {
    console.error('unarchiveConversation error:', err);
    return res.status(500).json({ error: 'Không thể bỏ lưu trữ cuộc trò chuyện' });
  }
};

exports.deleteConversation = async (req, res) => {
  try {
    const { conversationId } = req.params || {};
    if (!conversationId) {
      return res.status(400).json({ error: 'conversationId is required' });
    }

    const userId = req.user.id;
    const conversation = await Conversation.findById(conversationId);

    if (!conversation) {
      return res.status(404).json({ error: 'Conversation not found' });
    }

    const isParticipant = (conversation.participants ?? []).some(
      (participant) => normalizeObjectId(participant) === userId
    );

    if (!isParticipant) {
      return res.status(403).json({ error: 'Bạn không thuộc cuộc trò chuyện này' });
    }

    if (conversation.isGroup && (conversation.participants ?? []).length > 1) {
      return res
        .status(400)
        .json({ error: 'Không thể xoá nhóm khi vẫn còn thành viên khác. Hãy rời nhóm trước.' });
    }

    await Promise.all([
      Message.deleteMany({ conversation: conversationId }),
      Conversation.deleteOne({ _id: conversationId }),
    ]);

    return res.json({ conversationId, message: 'Đã xoá cuộc trò chuyện' });
  } catch (err) {
    console.error('deleteConversation error:', err);
    return res.status(500).json({ error: 'Không thể xoá cuộc trò chuyện' });
  }
};

exports.leaveConversation = async (req, res) => {
  try {
    const { conversationId } = req.params || {};
    const { mode } = req.body || {};
    if (!conversationId) {
      return res.status(400).json({ error: 'conversationId is required' });
    }

    const action = mode === 'block' ? 'block' : 'silent';
    const userId = req.user.id;

    const conversation = await Conversation.findById(conversationId);
    if (!conversation) {
      return res.status(404).json({ error: 'Conversation not found' });
    }
    if (!conversation.isGroup) {
      return res.status(400).json({ error: 'Chỉ có thể rời nhóm trong cuộc trò chuyện nhóm' });
    }

    const isParticipant = (conversation.participants ?? []).some(
      (participant) => normalizeObjectId(participant) === userId
    );
    if (!isParticipant) {
      return res.status(403).json({ error: 'Bạn không thuộc nhóm này' });
    }

    conversation.participants = (conversation.participants ?? []).filter(
      (participant) => normalizeObjectId(participant) !== userId
    );

    if (action === 'block') {
      const alreadyBlocked = (conversation.blockedParticipants ?? []).some(
        (entry) => normalizeObjectId(entry?.user) === userId
      );
      if (!alreadyBlocked) {
        conversation.blockedParticipants.push({
          user: userId,
          blockedAt: new Date(),
        });
      }
    } else {
      conversation.blockedParticipants = (conversation.blockedParticipants ?? []).filter(
        (entry) => normalizeObjectId(entry?.user) !== userId
      );
    }

    const shouldDelete = (conversation.participants ?? []).length === 0;

    if (shouldDelete) {
      await Promise.all([
        Message.deleteMany({ conversation: conversationId }),
        Conversation.deleteOne({ _id: conversationId }),
      ]);
    } else {
      await conversation.save();
    }

    return res.json({
      conversationId,
      mode: action,
      message: action === 'block' ? 'Đã rời nhóm và chặn được thêm trở lại.' : 'Đã rời nhóm.',
    });
  } catch (err) {
    console.error('leaveConversation error:', err);
    return res.status(500).json({ error: 'Không thể rời nhóm' });
  }
};


