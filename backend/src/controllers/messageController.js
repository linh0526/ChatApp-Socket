const Message = require('../models/Message');
const Conversation = require('../models/Conversation');
const { encryptText, decryptText } = require('../utils/encryption');
const { storeVoiceRecording, storeImageFile, storeFileAttachment } = require('../utils/storage');
const jwt = require('jsonwebtoken');
const JWT_SECRET = process.env.JWT_SECRET || 'dev_jwt_secret_change_me';

let ioInstance = null;
const socketUsers = new Map(); // Map socket.id -> { userId, username, conversationId }
const onlineUsers = new Set(); // Set of userId strings for quick lookup
const userSocketMap = new Map(); // Map userId -> Set<socketId>
const activeCalls = new Map(); // Map callId -> call metadata
const userActiveCallMap = new Map(); // Map userId -> callId
const CALL_TYPES = new Set(['audio', 'video']);

const setSocketIO = (io) => {
  ioInstance = io;
};

const attachSocketToUser = ({ socket, userId, username }) => {
  if (!socket || !userId) {
    return;
  }
  socketUsers.set(socket.id, { userId, username, conversationId: null });
  let sockets = userSocketMap.get(userId);
  const wasOffline = !sockets || sockets.size === 0;
  if (!sockets) {
    sockets = new Set();
    userSocketMap.set(userId, sockets);
  }
  sockets.add(socket.id);
  if (wasOffline) {
    onlineUsers.add(userId);
    if (ioInstance) {
      ioInstance.emit('user:online', { userId, username });
    }
  }
};

const detachSocketFromUser = (socketId) => {
  if (!socketId) return null;
  const userInfo = socketUsers.get(socketId);
  if (!userInfo) {
    return null;
  }
  socketUsers.delete(socketId);
  const sockets = userSocketMap.get(userInfo.userId);
  if (sockets) {
    sockets.delete(socketId);
    if (sockets.size === 0) {
      userSocketMap.delete(userInfo.userId);
      onlineUsers.delete(userInfo.userId);
      if (ioInstance) {
        ioInstance.emit('user:offline', { userId: userInfo.userId });
      }
    }
  }
  return userInfo;
};

const emitToUser = (userId, eventName, payload) => {
  if (!ioInstance || !userId || !eventName) {
    return false;
  }
  const sockets = userSocketMap.get(userId);
  if (!sockets || sockets.size === 0) {
    return false;
  }
  sockets.forEach((socketId) => {
    ioInstance.to(socketId).emit(eventName, payload);
  });
  return true;
};

const releaseCall = (callId) => {
  if (!callId) {
    return null;
  }
  const call = activeCalls.get(callId);
  if (!call) {
    return null;
  }
  activeCalls.delete(callId);
  userActiveCallMap.delete(call.initiatorId);
  userActiveCallMap.delete(call.targetUserId);
  return call;
};

const finalizeCallForUser = (userId, { reason = 'ended', endedBy } = {}) => {
  if (!userId) return;
  const callId = userActiveCallMap.get(userId);
  if (!callId) {
    return;
  }
  const call = releaseCall(callId);
  if (!call) {
    return;
  }
  const payload = { callId, reason, endedBy: endedBy ?? userId };
  emitToUser(call.initiatorId, 'call:ended', payload);
  emitToUser(call.targetUserId, 'call:ended', payload);
};

const decodeSocketToken = (token) => {
  if (!token) {
    const error = new Error('Authentication token is required');
    error.statusCode = 401;
    throw error;
  }
  return jwt.verify(token, JWT_SECRET);
};

const emitNewMessage = (message) => {
  if (ioInstance) {
    ioInstance.emit('message:new', message);
  }
};

const emitMessageUpdated = (message) => {
  if (ioInstance) {
    ioInstance.emit('message:updated', message);
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

const formatMessageForClient = (message, { decryptedContent } = {}) => {
  if (!message) {
    return null;
  }
  const plain =
    typeof message.toObject === 'function' ? message.toObject() : { ...message };
  if (typeof decryptedContent === 'string') {
    plain.content = decryptedContent;
  } else {
    try {
      plain.content = decryptText(plain.content);
    } catch (error) {
      console.error('Failed to decrypt message content:', error);
      plain.content = '';
    }
  }
  plain.voiceRecording = sanitizeVoiceRecording(plain.voiceRecording);
  plain.image = sanitizeImage(plain.image);
  plain.file = sanitizeFileAttachment(plain.file);
  return enrichMessageForClient(plain);
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
const FILE_PLACEHOLDER_CONTENT = 'Tệp đính kèm';
const RECALL_PLACEHOLDER_CONTENT = 'Tin nhắn đã được thu hồi';

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

const sanitizeFileAttachment = (file) => {
  if (!file) {
    return undefined;
  }

  const source = typeof file.toObject === 'function' ? file.toObject() : file;

  const resolvedUrl = buildUploadUrl(source.url, source.relativePath);
  if (resolvedUrl) {
    return {
      url: resolvedUrl,
      mimeType: source.mimeType || 'application/octet-stream',
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

  const resolvedMime = mimeType || 'application/octet-stream';
  const base64 = buffer.toString('base64');

  return {
    dataUrl: `data:${resolvedMime};base64,${base64}`,
    mimeType: resolvedMime,
    originalName: originalName || 'file.bin',
    size: size ?? buffer.length,
  };
};

const clearMessageAttachments = (message) => {
  if (!message || typeof message.set !== 'function') {
    return;
  }
  message.set('voiceRecording', undefined);
  message.set('image', undefined);
  message.set('file', undefined);
};

const createMessageDocument = async ({
  senderId,
  sender,
  content,
  conversationId,
  messageType = 'text',
  voiceRecording,
  image,
  fileAttachment,
}) => {
  if (!sender) {
    const error = new Error('sender is required');
    error.statusCode = 400;
    throw error;
  }

  const normalizedType = ['voice', 'image', 'file'].includes(messageType) ? messageType : 'text';
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
  } else if (normalizedType === 'file') {
    if (!fileAttachment) {
      const error = new Error('file metadata is required');
      error.statusCode = 400;
      throw error;
    }
    if (!trimmedContent) {
      trimmedContent = FILE_PLACEHOLDER_CONTENT;
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
    file: normalizedType === 'file' ? fileAttachment : undefined,
    conversation: conversation ? conversation._id : undefined,
  });

  if (conversation) {
    conversation.lastMessageAt = new Date();
    await conversation.save();
  }

  const enrichedMessage = formatMessageForClient(message, { decryptedContent: trimmedContent });

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
    const decryptedMessages = messages
      .map((message) => formatMessageForClient(message))
      .filter(Boolean);

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
      attachSocketToUser({ socket, userId, username });
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
      
      attachSocketToUser({ socket, userId, username });

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
      const messages = await Message.find(filter).sort({ createdAt: 1 });

      const serialized = messages
        .map((message) => formatMessageForClient(message))
        .filter(Boolean);

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

  const buildErrorMessage = (error, fallback) => {
    if (!error) return fallback;
    if (error.statusCode && error.statusCode < 500) {
      return error.message;
    }
    if (error.name === 'JsonWebTokenError') {
      return 'Phiên đăng nhập đã hết hạn';
    }
    return fallback;
  };

  socket.on('call:initiate', async (payload, callback) => {
    const reply = typeof callback === 'function' ? callback : () => {};
    try {
      const { token, callId, conversationId, callType, offer } = payload ?? {};
      const normalizedCallId = typeof callId === 'string' ? callId.trim() : '';
      const normalizedConversationId =
        typeof conversationId === 'string' ? conversationId.trim() : '';
      const normalizedCallType =
        typeof callType === 'string' ? callType.trim().toLowerCase() : '';

      if (!normalizedCallId) {
        const error = new Error('callId is required');
        error.statusCode = 400;
        throw error;
      }
      if (!normalizedConversationId) {
        const error = new Error('conversationId is required');
        error.statusCode = 400;
        throw error;
      }
      if (!CALL_TYPES.has(normalizedCallType)) {
        const error = new Error('Loại cuộc gọi không hợp lệ');
        error.statusCode = 400;
        throw error;
      }
      if (!offer || typeof offer !== 'object') {
        const error = new Error('Thiếu dữ liệu offer');
        error.statusCode = 400;
        throw error;
      }
      if (activeCalls.has(normalizedCallId)) {
        const error = new Error('callId đã tồn tại');
        error.statusCode = 409;
        throw error;
      }

      const decoded = decodeSocketToken(token);
      const callerId = decoded.id;
      const callerUsername = decoded.username;
      attachSocketToUser({ socket, userId: callerId, username: callerUsername });

      if (userActiveCallMap.has(callerId)) {
        const error = new Error('Bạn đang trong một cuộc gọi khác');
        error.statusCode = 409;
        throw error;
      }

      const conversation = await Conversation.findById(normalizedConversationId).select(
        'participants name isGroup',
      );
      if (!conversation) {
        const error = new Error('Conversation not found');
        error.statusCode = 404;
        throw error;
      }
      const participants = (conversation.participants ?? [])
        .map((participant) =>
          participant && typeof participant.toString === 'function'
            ? participant.toString()
            : typeof participant === 'string'
              ? participant
              : null,
        )
        .filter(Boolean);
      if (!participants.includes(callerId)) {
        const error = new Error('Bạn không có quyền trong cuộc trò chuyện này');
        error.statusCode = 403;
        throw error;
      }
      if (conversation.isGroup || participants.length !== 2) {
        const error = new Error('Cuộc gọi chỉ hỗ trợ trò chuyện 1-1');
        error.statusCode = 400;
        throw error;
      }

      const targetUserId = participants.find((participantId) => participantId !== callerId);
      if (!targetUserId) {
        const error = new Error('Không tìm thấy người nhận cuộc gọi');
        error.statusCode = 404;
        throw error;
      }
      if (userActiveCallMap.has(targetUserId)) {
        const error = new Error('Người nhận đang trong một cuộc gọi khác');
        error.statusCode = 409;
        throw error;
      }

      const delivered = emitToUser(targetUserId, 'call:incoming', {
        callId: normalizedCallId,
        conversationId: normalizedConversationId,
        callType: normalizedCallType,
        caller: { id: callerId, username: callerUsername },
        offer,
        conversationTitle: conversation.name || undefined,
      });
      if (!delivered) {
        const error = new Error('Người nhận đang ngoại tuyến');
        error.statusCode = 409;
        throw error;
      }

      activeCalls.set(normalizedCallId, {
        id: normalizedCallId,
        conversationId: normalizedConversationId,
        callType: normalizedCallType,
        initiatorId: callerId,
        targetUserId,
        status: 'ringing',
      });
      userActiveCallMap.set(callerId, normalizedCallId);
      userActiveCallMap.set(targetUserId, normalizedCallId);

      reply({ status: 'ok' });
    } catch (error) {
      reply({
        status: 'error',
        error: buildErrorMessage(error, 'Không thể bắt đầu cuộc gọi'),
      });
    }
  });

  socket.on('call:answer', async (payload, callback) => {
    const reply = typeof callback === 'function' ? callback : () => {};
    try {
      const { token, callId, answer } = payload ?? {};
      const normalizedCallId = typeof callId === 'string' ? callId.trim() : '';
      if (!normalizedCallId) {
        const error = new Error('callId is required');
        error.statusCode = 400;
        throw error;
      }
      if (!answer || typeof answer !== 'object') {
        const error = new Error('Thiếu dữ liệu answer');
        error.statusCode = 400;
        throw error;
      }

      const decoded = decodeSocketToken(token);
      const userId = decoded.id;
      const username = decoded.username;
      attachSocketToUser({ socket, userId, username });

      const call = activeCalls.get(normalizedCallId);
      if (!call) {
        const error = new Error('Cuộc gọi không tồn tại hoặc đã kết thúc');
        error.statusCode = 404;
        throw error;
      }
      if (call.targetUserId !== userId) {
        const error = new Error('Bạn không thể trả lời cuộc gọi này');
        error.statusCode = 403;
        throw error;
      }
      if (call.status !== 'ringing') {
        const error = new Error('Cuộc gọi đã được xử lý');
        error.statusCode = 409;
        throw error;
      }

      call.status = 'active';
      const delivered = emitToUser(call.initiatorId, 'call:answer', {
        callId: normalizedCallId,
        answer,
      });
      if (!delivered) {
        releaseCall(normalizedCallId);
        const error = new Error('Không thể kết nối với người gọi');
        error.statusCode = 500;
        throw error;
      }

      reply({ status: 'ok' });
    } catch (error) {
      reply({
        status: 'error',
        error: buildErrorMessage(error, 'Không thể trả lời cuộc gọi'),
      });
    }
  });

  socket.on('call:ice-candidate', async (payload, callback) => {
    const reply = typeof callback === 'function' ? callback : () => {};
    try {
      const { token, callId, candidate } = payload ?? {};
      const normalizedCallId = typeof callId === 'string' ? callId.trim() : '';
      if (!normalizedCallId) {
        const error = new Error('callId is required');
        error.statusCode = 400;
        throw error;
      }
      if (!candidate || typeof candidate !== 'object') {
        const error = new Error('Thiếu dữ liệu candidate');
        error.statusCode = 400;
        throw error;
      }

      const decoded = decodeSocketToken(token);
      const userId = decoded.id;
      const username = decoded.username;
      attachSocketToUser({ socket, userId, username });

      const call = activeCalls.get(normalizedCallId);
      if (!call) {
        const error = new Error('Cuộc gọi không tồn tại hoặc đã kết thúc');
        error.statusCode = 404;
        throw error;
      }
      if (call.initiatorId !== userId && call.targetUserId !== userId) {
        const error = new Error('Bạn không có quyền với cuộc gọi này');
        error.statusCode = 403;
        throw error;
      }

      const otherUserId = call.initiatorId === userId ? call.targetUserId : call.initiatorId;
      emitToUser(otherUserId, 'call:ice-candidate', {
        callId: normalizedCallId,
        candidate,
      });
      reply({ status: 'ok' });
    } catch (error) {
      reply({
        status: 'error',
        error: buildErrorMessage(error, 'Không thể gửi dữ liệu ICE'),
      });
    }
  });

  socket.on('call:decline', async (payload, callback) => {
    const reply = typeof callback === 'function' ? callback : () => {};
    try {
      const { token, callId } = payload ?? {};
      const normalizedCallId = typeof callId === 'string' ? callId.trim() : '';
      if (!normalizedCallId) {
        const error = new Error('callId is required');
        error.statusCode = 400;
        throw error;
      }

      const decoded = decodeSocketToken(token);
      const userId = decoded.id;
      const username = decoded.username;
      attachSocketToUser({ socket, userId, username });

      const call = activeCalls.get(normalizedCallId);
      if (!call) {
        const error = new Error('Cuộc gọi không tồn tại hoặc đã kết thúc');
        error.statusCode = 404;
        throw error;
      }
      if (call.targetUserId !== userId) {
        const error = new Error('Bạn không thể từ chối cuộc gọi này');
        error.statusCode = 403;
        throw error;
      }

      releaseCall(normalizedCallId);
      emitToUser(call.initiatorId, 'call:declined', { callId: normalizedCallId });
      reply({ status: 'ok' });
    } catch (error) {
      reply({
        status: 'error',
        error: buildErrorMessage(error, 'Không thể từ chối cuộc gọi'),
      });
    }
  });

  socket.on('call:cancel', async (payload, callback) => {
    const reply = typeof callback === 'function' ? callback : () => {};
    try {
      const { token, callId } = payload ?? {};
      const normalizedCallId = typeof callId === 'string' ? callId.trim() : '';
      if (!normalizedCallId) {
        const error = new Error('callId is required');
        error.statusCode = 400;
        throw error;
      }

      const decoded = decodeSocketToken(token);
      const userId = decoded.id;
      const username = decoded.username;
      attachSocketToUser({ socket, userId, username });

      const call = activeCalls.get(normalizedCallId);
      if (!call) {
        const error = new Error('Cuộc gọi không tồn tại hoặc đã kết thúc');
        error.statusCode = 404;
        throw error;
      }
      if (call.initiatorId !== userId) {
        const error = new Error('Bạn không thể huỷ cuộc gọi này');
        error.statusCode = 403;
        throw error;
      }

      releaseCall(normalizedCallId);
      emitToUser(call.targetUserId, 'call:cancelled', { callId: normalizedCallId });
      reply({ status: 'ok' });
    } catch (error) {
      reply({
        status: 'error',
        error: buildErrorMessage(error, 'Không thể huỷ cuộc gọi'),
      });
    }
  });

  socket.on('call:end', async (payload, callback) => {
    const reply = typeof callback === 'function' ? callback : () => {};
    try {
      const { token, callId, reason } = payload ?? {};
      const normalizedCallId = typeof callId === 'string' ? callId.trim() : '';
      if (!normalizedCallId) {
        const error = new Error('callId is required');
        error.statusCode = 400;
        throw error;
      }

      const decoded = decodeSocketToken(token);
      const userId = decoded.id;
      const username = decoded.username;
      attachSocketToUser({ socket, userId, username });

      const call = activeCalls.get(normalizedCallId);
      if (!call) {
        const error = new Error('Cuộc gọi không tồn tại hoặc đã kết thúc');
        error.statusCode = 404;
        throw error;
      }
      if (call.initiatorId !== userId && call.targetUserId !== userId) {
        const error = new Error('Bạn không tham gia cuộc gọi này');
        error.statusCode = 403;
        throw error;
      }

      releaseCall(normalizedCallId);
      const otherUserId = call.initiatorId === userId ? call.targetUserId : call.initiatorId;
      emitToUser(otherUserId, 'call:ended', {
        callId: normalizedCallId,
        reason: reason || 'ended',
        endedBy: userId,
      });
      reply({ status: 'ok' });
    } catch (error) {
      reply({
        status: 'error',
        error: buildErrorMessage(error, 'Không thể kết thúc cuộc gọi'),
      });
    }
  });


  socket.on('disconnect', () => {
    const userInfo = detachSocketFromUser(socket.id);
    if (userInfo) {
      finalizeCallForUser(userInfo.userId, { reason: 'disconnect', endedBy: userInfo.userId });
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

const createFileMessage = async (req, res) => {
  try {
    const { conversationId } = req.query || {};
    const sender = req.user?.username;
    const senderId = req.user?.id;

    if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
      return res.status(400).json({ error: 'Dữ liệu tệp không hợp lệ' });
    }

    let contentType = req.headers['content-type'] || 'application/octet-stream';
    if (contentType.includes(';')) {
      contentType = contentType.split(';')[0].trim();
    }

    const originalNameHeader = req.headers['x-file-filename'] || req.headers['x-attachment-filename'];
    const originalName = Array.isArray(originalNameHeader)
      ? originalNameHeader[0]
      : originalNameHeader;

    const fileBuffer = Buffer.from(req.body);
    let storedFile = null;
    try {
      const stored = await storeFileAttachment({
        buffer: fileBuffer,
        mimeType: contentType || 'application/octet-stream',
        originalName: originalName || `file-${Date.now()}`,
        userId: senderId || 'anonymous',
      });
      storedFile = {
        mimeType: stored.mimeType,
        size: stored.size,
        originalName: stored.originalName,
        relativePath: stored.relativePath,
        url: stored.url,
      };
    } catch (storageError) {
      console.error('Failed to store file on disk, falling back to inline buffer:', storageError);
      storedFile = {
        data: fileBuffer,
        mimeType: contentType || 'application/octet-stream',
        size: fileBuffer.length,
        originalName: originalName || `file-${Date.now()}`,
      };
    }

    const message = await createMessageDocument({
      senderId,
      sender,
      content: FILE_PLACEHOLDER_CONTENT,
      conversationId,
      messageType: 'file',
      fileAttachment: storedFile,
    });

    res.status(201).json(message);
  } catch (error) {
    const statusCode = error.statusCode || 500;
    if (statusCode >= 500) {
      console.error('Error creating file message:', error);
    }
    res.status(statusCode).json({ error: error.message || 'Failed to create file message' });
  }
};

const recallMessage = async (req, res) => {
  try {
    const { messageId } = req.params || {};
    if (!messageId) {
      return res.status(400).json({ error: 'messageId is required' });
    }

    const message = await Message.findById(messageId);
    if (!message) {
      return res.status(404).json({ error: 'Không tìm thấy tin nhắn' });
    }

    const userId = req.user.id;
    const normalizedUsername = (req.user.username || '').toLowerCase();

    const isSender =
      (message.senderId && message.senderId.toString() === userId) ||
      (!message.senderId &&
        normalizedUsername &&
        typeof message.sender === 'string' &&
        message.sender.toLowerCase() === normalizedUsername);

    if (!isSender) {
      return res.status(403).json({ error: 'Bạn chỉ có thể thu hồi tin nhắn của chính mình' });
    }

    let updated = false;
    if (!message.isRecalled) {
      message.content = encryptText(RECALL_PLACEHOLDER_CONTENT);
      message.messageType = 'text';
      clearMessageAttachments(message);
      message.isRecalled = true;
      message.recalledAt = new Date();
      message.recalledBy = userId;
      await message.save();
      updated = true;
    }

    const formatted = formatMessageForClient(message, {
      decryptedContent: RECALL_PLACEHOLDER_CONTENT,
    });

    if (updated && formatted) {
      emitMessageUpdated(formatted);
    }

    return res.json(formatted);
  } catch (error) {
    console.error('recallMessage error:', error);
    return res.status(500).json({ error: 'Không thể thu hồi tin nhắn' });
  }
};

const searchMessages = async (req, res) => {
  try {
    const { conversationId, query = '', limit } = req.query || {};
    const trimmedQuery = String(query || '').trim();

    if (!conversationId) {
      return res.status(400).json({ error: 'conversationId is required' });
    }
    if (!trimmedQuery) {
      return res.status(400).json({ error: 'query is required' });
    }

    const conversation = await Conversation.findById(conversationId).select('participants');
    if (!conversation) {
      return res.status(404).json({ error: 'Conversation not found' });
    }

    const userId = req.user.id;
    const isParticipant = conversation.participants.some(
      (participant) => participant?.toString?.() === userId
    );
    if (!isParticipant) {
      return res.status(403).json({ error: 'Không có quyền truy cập cuộc trò chuyện' });
    }

    const limitValue = Math.min(Math.max(parseInt(limit, 10) || 20, 1), 100);
    const normalizedQuery = trimmedQuery.toLowerCase();

    const candidates = await Message.find({ conversation: conversationId })
      .sort({ createdAt: -1 })
      .limit(500);

    const matches = [];
    for (const message of candidates) {
      if (message.isRecalled) {
        continue;
      }
      let decryptedContent = '';
      try {
        decryptedContent = decryptText(message.content);
      } catch (error) {
        decryptedContent = '';
      }

      const attachmentNames = [
        message.voiceRecording?.originalName,
        message.image?.originalName,
        message.file?.originalName,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();

      const haystack = `${decryptedContent} ${attachmentNames}`.toLowerCase();
      if (!haystack.includes(normalizedQuery)) {
        continue;
      }

      const formatted = formatMessageForClient(message, { decryptedContent });
      if (formatted) {
        matches.push(formatted);
      }

      if (matches.length >= limitValue) {
        break;
      }
    }

    return res.json(matches);
  } catch (error) {
    console.error('searchMessages error:', error);
    return res.status(500).json({ error: 'Không thể tìm kiếm tin nhắn' });
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
  createFileMessage,
  recallMessage,
  searchMessages,
  registerSocketHandlers,
  setSocketIO,
  getOnlineUserIds,
  isUserOnline,
  markMessagesSeen: markMessagesSeenController,
};

