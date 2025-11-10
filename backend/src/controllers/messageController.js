const Message = require('../models/Message');

let ioInstance = null;

const setSocketIO = (io) => {
  ioInstance = io;
};

const emitNewMessage = (message) => {
  if (ioInstance) {
    ioInstance.emit('message:new', message);
  }
};

const createMessageDocument = async ({ sender, content }) => {
  if (!sender || !content) {
    const error = new Error('sender and content are required');
    error.statusCode = 400;
    throw error;
  }

  const message = await Message.create({
    sender: sender.trim(),
    content: content.trim(),
  });

  const plainMessage = message.toObject();
  emitNewMessage(plainMessage);
  return plainMessage;
};

const getMessages = async (req, res) => {
  try {
    const messages = await Message.find().sort({ createdAt: 1 });
    res.json(messages);
  } catch (error) {
    console.error('Error fetching messages:', error);
    res.status(500).json({ error: 'Failed to fetch messages' });
  }
};

const createMessage = async (req, res) => {
  try {
    const message = await createMessageDocument(req.body);
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
  socket.on('message:send', async (payload, callback) => {
    try {
      const message = await createMessageDocument(payload ?? {});
      if (typeof callback === 'function') {
        callback({ status: 'ok', data: message });
      }
    } catch (error) {
      if (typeof callback === 'function') {
        callback({
          status: 'error',
          error: error.statusCode === 400 ? error.message : 'Failed to create message',
        });
      }

      if (!error.statusCode || error.statusCode >= 500) {
        console.error('Error handling socket message:', error);
      }
    }
  });
};

module.exports = { getMessages, createMessage, registerSocketHandlers, setSocketIO };

