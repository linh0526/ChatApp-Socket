const Message = require('../models/Message');
const Conversation = require('../models/Conversation');
const jwt = require('jsonwebtoken');
const JWT_SECRET = process.env.JWT_SECRET || 'dev_jwt_secret_change_me';

let ioInstance = null;

const setSocketIO = (io) => {
  ioInstance = io;
};

const emitNewMessage = (message) => {
  if (ioInstance) {
    ioInstance.emit('message:new', message);
  }
};

const createMessageDocument = async ({ sender, content, conversationId }) => {
  if (!sender || !content) {
    const error = new Error('sender and content are required');
    error.statusCode = 400;
    throw error;
  }

  let conversation = null;
  if (conversationId) {
    conversation = await Conversation.findById(conversationId);
    if (!conversation) {
      const error = new Error('Conversation not found');
      error.statusCode = 404;
      throw error;
    }
  }

  const message = await Message.create({
    sender: sender.trim(),
    content: content.trim(),
    conversation: conversation ? conversation._id : undefined,
  });

  if (conversation) {
    conversation.lastMessageAt = new Date();
    await conversation.save();
  }

  const plainMessage = message.toObject();
  emitNewMessage(plainMessage);
  return plainMessage;
};

const getMessages = async (req, res) => {
  try {
    const { conversationId } = req.query || {};
    const filter = conversationId ? { conversation: conversationId } : {};
    const messages = await Message.find(filter).sort({ createdAt: 1 });
    res.json(messages);
  } catch (error) {
    console.error('Error fetching messages:', error);
    res.status(500).json({ error: 'Failed to fetch messages' });
  }
};

const createMessage = async (req, res) => {
  try {
    const { content, conversationId } = req.body || {};
    const sender = req.user?.username;
    const message = await createMessageDocument({ sender, content, conversationId });
    res.status(201).json(message);
  } catch (error) {
    const statusCode = error.statusCode || 500;
    if (statusCode >= 500) {
      console.error('Error creating message:', error);
    }
    res.status(statusCode).json({ error: error.message || 'Failed to create message' });
  }
};

const registerSocketHandlers = (socket) => {
  socket.on('message:list', async (payload, callback) => {
    try {
      const { token, conversationId } = payload ?? {};
      if (!token) {
        throw Object.assign(new Error('Authentication token is required'), { statusCode: 401 });
      }

      jwt.verify(token, JWT_SECRET);

      const filter = conversationId ? { conversation: conversationId } : {};
      const messages = await Message.find(filter).sort({ createdAt: 1 }).lean();

      const serialized = messages.map((message) => ({
        ...message,
        _id: message._id?.toString?.() ?? message._id,
        conversation: message.conversation?.toString?.(),
        createdAt: message.createdAt instanceof Date ? message.createdAt.toISOString() : message.createdAt,
        updatedAt: message.updatedAt instanceof Date ? message.updatedAt.toISOString() : message.updatedAt,
      }));

      if (typeof callback === 'function') {
        callback({ status: 'ok', data: serialized });
      }
    } catch (error) {
      if (typeof callback === 'function') {
        callback({
          status: 'error',
          error:
            error.statusCode === 400 ||
            error.statusCode === 401 ||
            error.statusCode === 404 ||
            error.name === 'JsonWebTokenError'
              ? error.message
              : 'Failed to fetch messages',
        });
      }

      if (!error.statusCode || error.statusCode >= 500) {
        console.error('Error handling socket message:list:', error);
      }
    }
  });

  socket.on('message:send', async (payload, callback) => {
    try {
      const { token, content, conversationId } = payload ?? {};
      const decoded = jwt.verify(token, JWT_SECRET);
      const sender = decoded.username;
      const message = await createMessageDocument({ sender, content, conversationId });
      if (typeof callback === 'function') {
        callback({ status: 'ok', data: message });
      }
    } catch (error) {
      if (typeof callback === 'function') {
        callback({
          status: 'error',
          error:
            error.statusCode === 400 || error.statusCode === 404 || error.name === 'JsonWebTokenError'
              ? error.message
              : 'Failed to create message',
        });
      }

      if (!error.statusCode || error.statusCode >= 500) {
        console.error('Error handling socket message:', error);
      }
    }
  });
};

module.exports = { getMessages, createMessage, registerSocketHandlers, setSocketIO };

