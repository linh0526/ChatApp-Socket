const Message = require('../models/Message');
const Conversation = require('../models/Conversation');
const { encryptText, decryptText } = require('../utils/encryption');
const { storeVoiceRecording, storeImageFile } = require('../utils/storage');
const jwt = require('jsonwebtoken');
const JWT_SECRET = process.env.JWT_SECRET || 'dev_jwt_secret_change_me';

let ioInstance = null;
const socketUsers = new Map(); // Map socket.id -> { userId, username, conversationId }
const onlineUsers = new Set(); // Set of userId strings for quick lookup

const setSocketIO = (io) => {
  ioInstance = io;
};

const emitNewMessage = (message) => {
  if (ioInstance) {
    ioInstance.emit('message:new', message);
  }
};

const mapObjectIdsToStrings = (items) => {
  if (!Array.isArray(items)) {
    return [];
  }
  return items
    .map((item) => {
      if (!item) return null;
      if (typeof item === 'string') return item;
      if (typeof item.toString === 'function') return item.toString();
      return String(item);
    })
    .filter(Boolean);
};

const enrichMessageForClient = (message) => {
  if (!message) {
    return message;
  }
  const payload = typeof message.toObject === 'function' ? message.toObject() : { ...message };

  if (payload._id && typeof payload._id !== 'string') {
    payload._id = payload._id.toString();
  }
  if (payload.conversation && typeof payload.conversation !== 'string') {
    payload.conversation = payload.conversation.toString();
  }
  if (payload.senderId && typeof payload.senderId !== 'string') {
    payload.senderId = payload.senderId.toString();
  }
  payload.seenBy = mapObjectIdsToStrings(payload.seenBy);

  return payload;
};

const broadcastMessagesSeen = (conversationId, viewerId, messageIds) => {
  if (!ioInstance || !conversationId || !Array.isArray(messageIds) || messageIds.length === 0) {
    return;
  }
  ioInstance.emit('message:seen', {
    conversationId: conversationId.toString(),
    viewerId,
    messageIds,
  });
};

const markMessagesAsSeen = async ({
  conversationId,
  viewerId,
  viewerUsername,
  messageIds = [],
  emitEvent = true,
}) => {
  if (!conversationId || !viewerId) {
    return [];
  }

  const normalizedIds = Array.isArray(messageIds)
    ? messageIds
        .map((id) => (typeof id === 'string' ? id.trim() : null))
        .filter(Boolean)
    : [];

  const baseFilter = {
    conversation: conversationId,
    seenBy: { $ne: viewerId },
    $and: [
      {
        $or: [
          { senderId: { $exists: false } },
          { senderId: { $ne: viewerId } },
        ],
      },
    ],
  };

  if (viewerUsername) {
    baseFilter.$and.push({
      $or: [
        { sender: { $exists: false } },
        { sender: { $ne: viewerUsername } },
      ],
    });
  }

  if (normalizedIds.length > 0) {
    baseFilter._id = { $in: normalizedIds };
  }

  const targetMessages = await Message.find(baseFilter).select('_id').lean();
  if (targetMessages.length === 0) {
    return [];
  }

  const ids = targetMessages.map((msg) => msg._id.toString());
  await Message.updateMany(
    { _id: { $in: targetMessages.map((msg) => msg._id) } },
    { $addToSet: { seenBy: viewerId } }
  );

  if (emitEvent) {
    broadcastMessagesSeen(conversationId, viewerId, ids);
  }

  return ids;
};

const VOICE_PLACEHOLDER_CONTENT = 'Tin nhắn thoại';
const IMAGE_PLACEHOLDER_CONTENT = 'Hình ảnh';

const buildUploadUrl = (url, relativePath) => {
  if (typeof url === 'string' && url.trim()) {
    return url.trim();
  }
  if (typeof relativePath === 'string' && relativePath.trim()) {
    const normalized = relativePath.replace(/^[./\\]+/, '').split('\\').join('/');
    return `/uploads/${normalized}`;
  }
  return null;
};

const sanitizeVoiceRecording = (voiceRecording) => {
  if (!voiceRecording) {
    return undefined;
  }

  const source = typeof voiceRecording.toObject === 'function' ? voiceRecording.toObject() : voiceRecording;

  // Backward compatibility: older records stored URL-based metadata
  const resolvedUrl = buildUploadUrl(source.url, source.relativePath);
  if (resolvedUrl) {
    return {
      url: resolvedUrl,
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

const sanitizeImage = (image) => {
  if (!image) {
    return undefined;
  }

  const source = typeof image.toObject === 'function' ? image.toObject() : image;

  // Backward compatibility: older records stored URL-based metadata
  const resolvedUrl = buildUploadUrl(source.url, source.relativePath);
  if (resolvedUrl) {
    return {
      url: resolvedUrl,
      mimeType: source.mimeType || 'image/jpeg',
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

  const resolvedMime = mimeType || 'image/jpeg';
  const base64 = buffer.toString('base64');

  return {
    dataUrl: `data:${resolvedMime};base64,${base64}`,
    mimeType: resolvedMime,
    originalName: originalName || 'image.jpg',
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
  image,
}) => {
  if (!sender) {
    const error = new Error('sender is required');
    error.statusCode = 400;
    throw error;
  }

  const normalizedType = messageType === 'voice' ? 'voice' : messageType === 'image' ? 'image' : 'text';
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
  } else if (normalizedType === 'image') {
    if (!image) {
      const error = new Error('image metadata is required');
      error.statusCode = 400;
      throw error;
    }
    if (!trimmedContent) {
      trimmedContent = IMAGE_PLACEHOLDER_CONTENT;
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
    senderId: senderId || undefined,
    content: encryptedContent,
    messageType: normalizedType,
    voiceRecording: normalizedType === 'voice' ? voiceRecording : undefined,
    image: normalizedType === 'image' ? image : undefined,
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
  const sanitizedImage = sanitizeImage(plainMessage.image);
  plainMessage.image = sanitizedImage ?? sanitizeImage(image) ?? undefined;
  const enrichedMessage = enrichMessageForClient(plainMessage);

  emitNewMessage(enrichedMessage);
  return enrichedMessage;
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
      plain.image = sanitizeImage(plain.image);
      return enrichMessageForClient(plain);
    });

    if (conversationId) {
      await markMessagesAsSeen({
        conversationId,
        viewerId: req.user.id,
        viewerUsername: req.user.username,
      });
    }

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
  // Track user online when they authenticate
  socket.on('user:authenticate', async (payload) => {
    try {
      const { token } = payload ?? {};
      if (!token) return;
      
      const decoded = jwt.verify(token, JWT_SECRET);
      const userId = decoded.id;
      const username = decoded.username;
      
      // Track user as online
      if (!onlineUsers.has(userId)) {
        onlineUsers.add(userId);
        socketUsers.set(socket.id, { userId, username, conversationId: null });
        // Notify others that user came online
        if (ioInstance) {
          ioInstance.emit('user:online', { userId, username });
        }
      }
    } catch (error) {
      // Ignore auth errors
    }
  });

  socket.on('message:list', async (payload, callback) => {
    try {
      const { token, conversationId } = payload ?? {};
      if (!token) {
        throw Object.assign(new Error('Authentication token is required'), { statusCode: 401 });
      }

      const decoded = jwt.verify(token, JWT_SECRET);
      const userId = decoded.id;
      const username = decoded.username;
      
      // Track user as online when they use any authenticated event
      if (!onlineUsers.has(userId)) {
        onlineUsers.add(userId);
        socketUsers.set(socket.id, { userId, username, conversationId: null });
        if (ioInstance) {
          ioInstance.emit('user:online', { userId, username });
        }
      }

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

        const formatted = {
          ...message,
          content: decryptedContent,
          voiceRecording: sanitizeVoiceRecording(message.voiceRecording),
          image: sanitizeImage(message.image),
        };
        return enrichMessageForClient(formatted);
      });

      if (conversationId) {
        await markMessagesAsSeen({
          conversationId,
          viewerId: userId,
          viewerUsername: username,
        });
      }

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

  socket.on('message:mark-seen', async (payload, callback) => {
    try {
      const { token, conversationId, messageIds } = payload ?? {};
      if (!token) {
        const error = new Error('Authentication token is required');
        error.statusCode = 401;
        throw error;
      }
      if (!conversationId) {
        const error = new Error('conversationId is required');
        error.statusCode = 400;
        throw error;
      }

      const decoded = jwt.verify(token, JWT_SECRET);
      const userId = decoded.id;

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

      const updatedMessageIds = await markMessagesAsSeen({
        conversationId,
        viewerId: userId,
        viewerUsername: decoded.username,
        messageIds,
      });

      if (typeof callback === 'function') {
        callback({ status: 'ok', data: { updatedMessageIds } });
      }
    } catch (error) {
      if (typeof callback === 'function') {
        callback({
          status: 'error',
          error:
            error.statusCode === 400 ||
            error.statusCode === 401 ||
            error.statusCode === 403 ||
            error.statusCode === 404 ||
            error.name === 'JsonWebTokenError'
              ? error.message
              : 'Không thể cập nhật trạng thái tin nhắn',
        });
      }

      if (!error.statusCode || error.statusCode >= 500) {
        console.error('Error handling socket message:mark-seen:', error);
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
      console.log('[Backend] User:', username, 'Conversation:', conversationId);

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
      console.log('[Backend] Stored socket info for user:', username);

      // Forward offer to other participants in the conversation
      if (conversationId && ioInstance) {
        const conversation = await Conversation.findById(conversationId).select('participants');
        if (conversation) {
          let forwarded = false;
          conversation.participants.forEach((participantId) => {
            if (participantId.toString() !== userId) {
              // Find sockets for this participant
              ioInstance.sockets.sockets.forEach((otherSocket) => {
                const otherUser = socketUsers.get(otherSocket.id);
                if (otherUser && otherUser.userId === participantId.toString()) {
                  console.log('[Backend] 📤 Forwarding offer to user:', otherUser.username);
                  otherSocket.emit('video-call:offer', { conversationId, offer, from: username });
                  forwarded = true;
                }
              });
            }
          });
          if (!forwarded) {
            console.log('[Backend] ⚠️ No online participants found to forward offer');
          }
        }
      }
    } catch (error) {
      console.error('[Backend] ❌ Error handling video-call:offer:', error);
    }
  });

  socket.on('video-call:answer', async (payload) => {
    try {
      console.log('[Backend] 📨 Received video-call:answer');
      const { token, conversationId, answer } = payload ?? {};
      if (!token) {
        console.log('[Backend] ❌ No token provided');
        return;
      }
      
      const decoded = jwt.verify(token, JWT_SECRET);
      const userId = decoded.id;
      console.log('[Backend] Answer from user:', userId, 'Conversation:', conversationId);

      // Forward answer to the caller
      if (conversationId && ioInstance) {
        const conversation = await Conversation.findById(conversationId).select('participants');
        if (conversation) {
          let forwarded = false;
          conversation.participants.forEach((participantId) => {
            if (participantId.toString() !== userId) {
              ioInstance.sockets.sockets.forEach((otherSocket) => {
                const otherUser = socketUsers.get(otherSocket.id);
                if (otherUser && otherUser.userId === participantId.toString() && otherUser.conversationId === conversationId) {
                  console.log('[Backend] 📤 Forwarding answer to user:', otherUser.username);
                  otherSocket.emit('video-call:answer', { conversationId, answer });
                  forwarded = true;
                }
              });
            }
          });
          if (!forwarded) {
            console.log('[Backend] ⚠️ No caller found to forward answer');
          }
        }
      }
    } catch (error) {
      console.error('[Backend] ❌ Error handling video-call:answer:', error);
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
      console.error('[Backend] ❌ Error handling video-call:ice-candidate:', error);
    }
  });

  socket.on('video-call:end', async (payload) => {
    try {
      console.log('[Backend] 📞 Received video-call:end');
      const { token, conversationId } = payload ?? {};
      if (!token) {
        console.log('[Backend] ❌ No token provided');
        return;
      }
      
      const decoded = jwt.verify(token, JWT_SECRET);
      const userId = decoded.id;
      console.log('[Backend] Call ended by user:', userId, 'Conversation:', conversationId);

      // Notify other participants
      if (conversationId && ioInstance) {
        const conversation = await Conversation.findById(conversationId).select('participants');
        if (conversation) {
          let notified = false;
          conversation.participants.forEach((participantId) => {
            if (participantId.toString() !== userId) {
              ioInstance.sockets.sockets.forEach((otherSocket) => {
                const otherUser = socketUsers.get(otherSocket.id);
                if (otherUser && otherUser.userId === participantId.toString() && otherUser.conversationId === conversationId) {
                  console.log('[Backend] 📤 Notifying user:', otherUser.username, 'that call ended');
                  otherSocket.emit('video-call:ended', { conversationId });
                  notified = true;
                }
              });
            }
          });
          if (!notified) {
            console.log('[Backend] ⚠️ No online participants to notify');
          }
        }
      }

      // Clean up
      socketUsers.delete(socket.id);
      console.log('[Backend] ✅ Call ended and cleaned up');
    } catch (error) {
      console.error('[Backend] ❌ Error handling video-call:end:', error);
    }
  });

  socket.on('disconnect', () => {
    const userInfo = socketUsers.get(socket.id);
    if (userInfo) {
      socketUsers.delete(socket.id);
      onlineUsers.delete(userInfo.userId);
      // Notify others that user went offline
      if (ioInstance) {
        ioInstance.emit('user:offline', { userId: userInfo.userId });
      }
    }
  });
};

// Helper function to get online user IDs
const getOnlineUserIds = () => {
  return Array.from(onlineUsers);
};

// Helper function to check if user is online
const isUserOnline = (userId) => {
  return onlineUsers.has(userId);
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
    let storedRecording = null;
    try {
      storedRecording = await storeVoiceRecording({
        buffer: audioBuffer,
        mimeType: contentType === 'application/octet-stream' ? 'audio/webm' : contentType,
        originalName: originalName || `voice-message-${Date.now()}.webm`,
        userId: senderId || 'anonymous',
      });
    } catch (storageError) {
      console.error('Failed to store voice recording on disk, falling back to inline buffer:', storageError);
      storedRecording = {
        data: audioBuffer,
        mimeType: contentType === 'application/octet-stream' ? 'audio/webm' : contentType,
        size: audioBuffer.length,
        originalName: originalName || `voice-message-${Date.now()}.webm`,
      };
    }

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

const createImageMessage = async (req, res) => {
  try {
    const { conversationId } = req.query || {};
    const sender = req.user?.username;
    const senderId = req.user?.id;

    console.log('[createImageMessage] Request received:', {
      conversationId,
      sender,
      contentType: req.headers['content-type'],
      bodySize: req.body?.length || 0,
      isBuffer: Buffer.isBuffer(req.body),
    });

    if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
      console.error('[createImageMessage] Invalid body:', {
        isBuffer: Buffer.isBuffer(req.body),
        length: req.body?.length || 0,
      });
      return res.status(400).json({ error: 'Dữ liệu hình ảnh không hợp lệ' });
    }

    // Get content type from header, handle multipart/form-data case
    let contentType = req.headers['content-type'] || 'image/jpeg';
    // If it's multipart, extract the actual image type from the boundary
    if (contentType.includes('multipart')) {
      // For raw body parser, we expect the actual image content
      // Try to detect from file extension or default to jpeg
      contentType = 'image/jpeg';
    } else if (contentType.includes(';')) {
      // Remove charset or boundary info
      contentType = contentType.split(';')[0].trim();
    }
    
    if (!contentType.startsWith('image/') && contentType !== 'application/octet-stream') {
      console.log('Unsupported content type:', contentType);
      return res.status(415).json({ error: `Định dạng hình ảnh không được hỗ trợ: ${contentType}` });
    }

    const originalNameHeader = req.headers['x-image-filename'];
    const originalName = Array.isArray(originalNameHeader)
      ? originalNameHeader[0]
      : originalNameHeader;

    const imageBuffer = Buffer.from(req.body);
    let storedImage = null;
    try {
      const stored = await storeImageFile({
        buffer: imageBuffer,
        mimeType: contentType === 'application/octet-stream' ? 'image/jpeg' : contentType,
        originalName: originalName || `image-${Date.now()}.jpg`,
        userId: senderId || 'anonymous',
      });
      storedImage = {
        mimeType: stored.mimeType,
        size: stored.size,
        originalName: stored.originalName,
        relativePath: stored.relativePath,
        url: stored.url,
      };
    } catch (storageError) {
      console.error('Failed to store image on disk, falling back to inline buffer:', storageError);
      storedImage = {
        data: imageBuffer,
        mimeType: contentType === 'application/octet-stream' ? 'image/jpeg' : contentType,
        size: imageBuffer.length,
        originalName: originalName || `image-${Date.now()}.jpg`,
      };
    }

    const message = await createMessageDocument({
      senderId,
      sender,
      content: IMAGE_PLACEHOLDER_CONTENT,
      conversationId,
      messageType: 'image',
      image: storedImage,
    });
    
    console.log('[createImageMessage] Message created:', {
      messageId: message._id,
      hasImage: !!message.image,
      imageSize: message.image?.size,
    });
    
    res.status(201).json(message);
  } catch (error) {
    const statusCode = error.statusCode || 500;
    if (statusCode >= 500) {
      console.error('Error creating image message:', error);
    }
    res.status(statusCode).json({ error: error.message || 'Failed to create image message' });
  }
};

const markMessagesSeenController = async (req, res) => {
  try {
    const { conversationId, messageIds } = req.body || {};
    if (!conversationId) {
      return res.status(400).json({ error: 'conversationId is required' });
    }

    const conversation = await Conversation.findById(conversationId).select('participants');
    if (!conversation) {
      return res.status(404).json({ error: 'Conversation not found' });
    }

    const viewerId = req.user.id;
    const isParticipant = conversation.participants.some(
      (participant) => participant?.toString?.() === viewerId
    );
    if (!isParticipant) {
      return res.status(403).json({ error: 'Không có quyền truy cập cuộc trò chuyện' });
    }

    const updatedMessageIds = await markMessagesAsSeen({
      conversationId,
      viewerId,
      viewerUsername: req.user.username,
      messageIds,
    });

    return res.json({ updatedMessageIds });
  } catch (error) {
    console.error('markMessagesSeen error:', error);
    return res.status(500).json({ error: 'Không thể cập nhật trạng thái tin nhắn' });
  }
};

module.exports = {
  getMessages,
  createMessage,
  createVoiceMessage,
  createImageMessage,
  registerSocketHandlers,
  setSocketIO,
  getOnlineUserIds,
  isUserOnline,
  markMessagesSeen: markMessagesSeenController,
};

