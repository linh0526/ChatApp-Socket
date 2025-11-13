const Message = require('../models/Message');
const Conversation = require('../models/Conversation');
const { encryptText, decryptText } = require('../utils/encryption');
const jwt = require('jsonwebtoken');
const JWT_SECRET = process.env.JWT_SECRET || 'dev_jwt_secret_change_me';

let ioInstance = null;
const socketUsers = new Map(); // Map socket.id -> { userId, username, conversationId }

const setSocketIO = (io) => {
  ioInstance = io;
};

const emitNewMessage = (message) => {
  if (ioInstance) {
    ioInstance.emit('message:new', message);
  }
};

const VOICE_PLACEHOLDER_CONTENT = 'Tin nhắn thoại';

const sanitizeVoiceRecording = (voiceRecording) => {
  if (!voiceRecording) {
    return undefined;
  }

  const source = typeof voiceRecording.toObject === 'function' ? voiceRecording.toObject() : voiceRecording;

  // Backward compatibility: older records stored URL-based metadata
  if (source.url) {
    return {
      url: source.url,
      mimeType: source.mimeType || 'audio/webm',
      originalName: source.originalName,
      size: source.size,
    };
  }

  const { data, mimeType, size, originalName } = source;

  let buffer = null;
  if (Buffer.isBuffer(data)) {
    buffer = data;
  } else if (data && typeof data === 'object' && Array.isArray(data.data)) {
    buffer = Buffer.from(data.data);
  }

  if (!buffer || buffer.length === 0) {
    return undefined;
  }

  const resolvedMime = mimeType || 'audio/webm';
  const base64 = buffer.toString('base64');

  return {
    dataUrl: `data:${resolvedMime};base64,${base64}`,
    mimeType: resolvedMime,
    originalName: originalName || 'voice-message.webm',
    size: size ?? buffer.length,
  };
};

const createMessageDocument = async ({
  senderId,
  sender,
  content,
  conversationId,
  messageType = 'text',
  voiceRecording,
}) => {
  if (!sender) {
    const error = new Error('sender is required');
    error.statusCode = 400;
    throw error;
  }

  const normalizedType = messageType === 'voice' ? 'voice' : 'text';
  const trimmedSender = sender.trim();
  let trimmedContent = typeof content === 'string' ? content.trim() : '';

  if (normalizedType === 'text') {
    if (!trimmedContent) {
      const error = new Error('content is required');
      error.statusCode = 400;
      throw error;
    }
  } else if (normalizedType === 'voice') {
    if (!voiceRecording) {
      const error = new Error('voice recording metadata is required');
      error.statusCode = 400;
      throw error;
    }
    if (!trimmedContent) {
      trimmedContent = VOICE_PLACEHOLDER_CONTENT;
    }
  }

  let conversation = null;
  if (conversationId) {
    conversation = await Conversation.findById(conversationId);
    if (!conversation) {
      const error = new Error('Conversation not found');
      error.statusCode = 404;
      throw error;
    }

    if (
      senderId &&
      !conversation.participants.some(
        (participant) => participant?.toString?.() === senderId
      )
    ) {
      const error = new Error('Bạn không có quyền trong cuộc trò chuyện này');
      error.statusCode = 403;
      throw error;
    }
  }

  const encryptedContent = encryptText(trimmedContent);

  const message = await Message.create({
    sender: trimmedSender,
    content: encryptedContent,
    messageType: normalizedType,
    voiceRecording: normalizedType === 'voice' ? voiceRecording : undefined,
    conversation: conversation ? conversation._id : undefined,
  });

  if (conversation) {
    conversation.lastMessageAt = new Date();
    await conversation.save();
  }

  const plainMessage = message.toObject();
  plainMessage.content = trimmedContent;
  const sanitizedVoiceRecording = sanitizeVoiceRecording(plainMessage.voiceRecording);
  plainMessage.voiceRecording =
    sanitizedVoiceRecording ?? sanitizeVoiceRecording(voiceRecording) ?? undefined;

  emitNewMessage(plainMessage);
  return plainMessage;
};

const getMessages = async (req, res) => {
  try {
    const { conversationId } = req.query || {};

    if (conversationId) {
      const conversation = await Conversation.findById(conversationId).select('participants');
      if (!conversation) {
        return res.status(404).json({ error: 'Conversation not found' });
      }
      const isParticipant = conversation.participants.some(
        (participant) => participant?.toString?.() === req.user.id
      );
      if (!isParticipant) {
        return res.status(403).json({ error: 'Không có quyền truy cập cuộc trò chuyện' });
      }
    }

    const filter = conversationId ? { conversation: conversationId } : { conversation: null };
    const messages = await Message.find(filter).sort({ createdAt: 1 });
    const decryptedMessages = messages.map((message) => {
      const plain = message.toObject();
      try {
        plain.content = decryptText(plain.content);
      } catch (error) {
        console.error('Failed to decrypt message content:', error);
        plain.content = '';
      }
      plain.voiceRecording = sanitizeVoiceRecording(plain.voiceRecording);
      return plain;
    });

    res.json(decryptedMessages);
  } catch (error) {
    console.error('Error fetching messages:', error);
    res.status(500).json({ error: 'Failed to fetch messages' });
  }
};

const createMessage = async (req, res) => {
  try {
    const { content, conversationId } = req.body || {};
    const sender = req.user?.username;
    const senderId = req.user?.id;

    const message = await createMessageDocument({
      senderId,
      sender,
      content,
      conversationId,
      messageType: 'text',
    });
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

      const decoded = jwt.verify(token, JWT_SECRET);
      const userId = decoded.id;

      if (conversationId) {
        const conversation = await Conversation.findById(conversationId).select('participants');
        if (!conversation) {
          const error = new Error('Conversation not found');
          error.statusCode = 404;
          throw error;
        }
        const isParticipant = conversation.participants.some(
          (participant) => participant?.toString?.() === userId
        );
        if (!isParticipant) {
          const error = new Error('Không có quyền truy cập cuộc trò chuyện');
          error.statusCode = 403;
          throw error;
        }
      }

      const filter = conversationId ? { conversation: conversationId } : { conversation: null };
      const messages = await Message.find(filter).sort({ createdAt: 1 }).lean();

      const serialized = messages.map((message) => {
        let decryptedContent = '';
        try {
          decryptedContent = decryptText(message.content);
        } catch (error) {
          console.error('Failed to decrypt message content:', error);
        }

        return {
          ...message,
          content: decryptedContent,
          voiceRecording: sanitizeVoiceRecording(message.voiceRecording),
          _id: message._id?.toString?.() ?? message._id,
          conversation: message.conversation?.toString?.(),
          createdAt:
            message.createdAt instanceof Date
              ? message.createdAt.toISOString()
              : message.createdAt,
          updatedAt:
            message.updatedAt instanceof Date
              ? message.updatedAt.toISOString()
              : message.updatedAt,
        };
      });

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
      const senderId = decoded.id;
      const message = await createMessageDocument({
        senderId,
        sender,
        content,
        conversationId,
        messageType: 'text',
      });
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

  // Video call handlers
  socket.on('video-call:offer', async (payload) => {
    try {
      const { token, conversationId, offer } = payload ?? {};
      if (!token) return;
      
      const decoded = jwt.verify(token, JWT_SECRET);
      const userId = decoded.id;
      const username = decoded.username;

      // Verify conversation access
      if (conversationId) {
        const conversation = await Conversation.findById(conversationId).select('participants');
        if (!conversation) return;
        
        const isParticipant = conversation.participants.some(
          (participant) => participant?.toString?.() === userId
        );
        if (!isParticipant) return;
      }

      // Store socket info
      socketUsers.set(socket.id, { userId, username, conversationId });

      // Forward offer to other participants in the conversation
      if (conversationId && ioInstance) {
        const conversation = await Conversation.findById(conversationId).select('participants');
        if (conversation) {
          conversation.participants.forEach((participantId) => {
            if (participantId.toString() !== userId) {
              // Find sockets for this participant
              ioInstance.sockets.sockets.forEach((otherSocket) => {
                const otherUser = socketUsers.get(otherSocket.id);
                if (otherUser && otherUser.userId === participantId.toString()) {
                  otherSocket.emit('video-call:offer', { conversationId, offer, from: username });
                }
              });
            }
          });
        }
      }
    } catch (error) {
      console.error('Error handling video-call:offer:', error);
    }
  });

  socket.on('video-call:answer', async (payload) => {
    try {
      const { token, conversationId, answer } = payload ?? {};
      if (!token) return;
      
      const decoded = jwt.verify(token, JWT_SECRET);
      const userId = decoded.id;

      // Forward answer to the caller
      if (conversationId && ioInstance) {
        const conversation = await Conversation.findById(conversationId).select('participants');
        if (conversation) {
          conversation.participants.forEach((participantId) => {
            if (participantId.toString() !== userId) {
              ioInstance.sockets.sockets.forEach((otherSocket) => {
                const otherUser = socketUsers.get(otherSocket.id);
                if (otherUser && otherUser.userId === participantId.toString() && otherUser.conversationId === conversationId) {
                  otherSocket.emit('video-call:answer', { conversationId, answer });
                }
              });
            }
          });
        }
      }
    } catch (error) {
      console.error('Error handling video-call:answer:', error);
    }
  });

  socket.on('video-call:ice-candidate', async (payload) => {
    try {
      const { token, conversationId, candidate } = payload ?? {};
      if (!token) return;
      
      const decoded = jwt.verify(token, JWT_SECRET);
      const userId = decoded.id;

      // Forward ICE candidate to other participants
      if (conversationId && ioInstance) {
        const conversation = await Conversation.findById(conversationId).select('participants');
        if (conversation) {
          conversation.participants.forEach((participantId) => {
            if (participantId.toString() !== userId) {
              ioInstance.sockets.sockets.forEach((otherSocket) => {
                const otherUser = socketUsers.get(otherSocket.id);
                if (otherUser && otherUser.userId === participantId.toString() && otherUser.conversationId === conversationId) {
                  otherSocket.emit('video-call:ice-candidate', { conversationId, candidate });
                }
              });
            }
          });
        }
      }
    } catch (error) {
      console.error('Error handling video-call:ice-candidate:', error);
    }
  });

  socket.on('video-call:end', async (payload) => {
    try {
      const { token, conversationId } = payload ?? {};
      if (!token) return;
      
      const decoded = jwt.verify(token, JWT_SECRET);
      const userId = decoded.id;

      // Notify other participants
      if (conversationId && ioInstance) {
        const conversation = await Conversation.findById(conversationId).select('participants');
        if (conversation) {
          conversation.participants.forEach((participantId) => {
            if (participantId.toString() !== userId) {
              ioInstance.sockets.sockets.forEach((otherSocket) => {
                const otherUser = socketUsers.get(otherSocket.id);
                if (otherUser && otherUser.userId === participantId.toString() && otherUser.conversationId === conversationId) {
                  otherSocket.emit('video-call:ended', { conversationId });
                }
              });
            }
          });
        }
      }

      // Clean up
      socketUsers.delete(socket.id);
    } catch (error) {
      console.error('Error handling video-call:end:', error);
    }
  });

  socket.on('disconnect', () => {
    socketUsers.delete(socket.id);
  });
};

const createVoiceMessage = async (req, res) => {
  try {
    const { conversationId } = req.query || {};
    const sender = req.user?.username;
    const senderId = req.user?.id;

    if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
      return res.status(400).json({ error: 'Dữ liệu ghi âm không hợp lệ' });
    }

    const contentType = req.headers['content-type'] || 'audio/webm';
    if (!contentType.startsWith('audio/') && contentType !== 'application/octet-stream') {
      return res.status(415).json({ error: 'Định dạng ghi âm không được hỗ trợ' });
    }

    const originalNameHeader = req.headers['x-audio-filename'];
    const originalName = Array.isArray(originalNameHeader)
      ? originalNameHeader[0]
      : originalNameHeader;

    const audioBuffer = Buffer.from(req.body);
    const storedRecording = {
      data: audioBuffer,
      mimeType: contentType === 'application/octet-stream' ? 'audio/webm' : contentType,
      size: audioBuffer.length,
      originalName: originalName || `voice-message-${Date.now()}.webm`,
    };

    const message = await createMessageDocument({
      senderId,
      sender,
      content: VOICE_PLACEHOLDER_CONTENT,
      conversationId,
      messageType: 'voice',
      voiceRecording: storedRecording,
    });
    res.status(201).json(message);
  } catch (error) {
    const statusCode = error.statusCode || 500;
    if (statusCode >= 500) {
      console.error('Error creating voice message:', error);
    }
    res.status(statusCode).json({ error: error.message || 'Failed to create voice message' });
  }
};

module.exports = {
  getMessages,
  createMessage,
  createVoiceMessage,
  registerSocketHandlers,
  setSocketIO,
};

