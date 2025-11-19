import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { io, type Socket } from 'socket.io-client';
import { AuthProvider, useAuth } from './AuthContext';
import { authHeaders, getToken } from './auth';
import Login from './pages/Login';
import Register from './pages/Register';
import { ChatLayout, type ConversationPreview } from './ChatLayout';
import type { ChatMessage } from './chatTypes';
import type {
  FriendActionFeedback,
  FriendRequestPreview,
  FriendRequestTarget,
  FriendSummary,
} from './friendTypes';

type VoiceRecording = {
  dataUrl?: string;
  url?: string;
  fileName?: string;
  originalName?: string;
  mimeType?: string;
  size?: number;
  relativePath?: string;
};

type Image = {
  dataUrl?: string;
  url?: string;
  fileName?: string;
  originalName?: string;
  mimeType?: string;
  size?: number;
  relativePath?: string;
};

type FileAttachment = {
  dataUrl?: string;
  url?: string;
  fileName?: string;
  originalName?: string;
  mimeType?: string;
  size?: number;
  relativePath?: string;
};

type Message = {
  _id: string;
  sender: string;
  senderId?: string | null;
  content: string;
  createdAt: string;
  conversation?: string | null;
  messageType?: 'text' | 'voice' | 'image' | 'file';
  voiceRecording?: VoiceRecording | null;
  image?: Image | null;
  file?: FileAttachment | null;
  seenBy?: string[];
};

type ConversationParticipantResponse = {
  id?: string;
  _id?: string;
  username: string;
  email: string;
};

type ConversationResponse = {
  _id: string;
  name?: string;
  isGroup?: boolean;
  participants?: ConversationParticipantResponse[];
  lastMessageAt?: string;
  updatedAt?: string;
  createdAt?: string;
};

const sortMessagesAsc = (items: Message[]) =>
  [...items].sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());

const API_BASE_URL =
  (import.meta.env.VITE_API_BASE_URL as string | undefined)?.replace(/\/$/, '') ?? '';

// For production: Use VITE_BACKEND_URL directly (no proxy)
// For local development: Use window.location.origin (proxy via vite.config.ts)
// Socket.IO will connect to /socket.io which is proxied to backend
const SOCKET_URL = 
  import.meta.env.PROD
    ? (import.meta.env.VITE_BACKEND_URL as string | undefined)?.replace(/\/$/, '') || API_BASE_URL
    : window.location.origin.replace(/\/$/, '');

const getInitials = (text: string) =>
  text
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0])
    .join('')
    .toUpperCase();

const buildSenderSnippet = (message: Message) =>
  message.sender ? `${message.sender}: ${message.content}` : message.content;

const sortConversations = (items: ConversationPreview[]) => {
  const unique = new Map<string, ConversationPreview>();
  for (const item of items) {
    unique.set(item.id, item);
  }
  const sorted = Array.from(unique.values()).sort((a, b) => {
    const timeA = a.updatedAt ? new Date(a.updatedAt).getTime() : 0;
    const timeB = b.updatedAt ? new Date(b.updatedAt).getTime() : 0;
    return timeB - timeA;
  });

  return sorted;
};

const mapConversationResponse = (
  conversation: ConversationResponse,
  currentUserId?: string | null,
): ConversationPreview => {
  const participants = (conversation.participants ?? []).map((participant) => {
    const rawId = participant.id ?? participant._id;
    const normalizedId = typeof rawId === 'string' ? rawId : '';
    return {
      id: normalizedId,
      username: participant.username,
      email: participant.email,
    };
  });

  const otherParticipant =
    !conversation.isGroup && currentUserId
      ? participants.find((participant) => participant.id && participant.id !== currentUserId)
      : undefined;

  const title =
    conversation.name?.trim() ||
    (conversation.isGroup ? 'Nhóm chưa đặt tên' : otherParticipant?.username ?? 'Cuộc trò chuyện');

  const subtitle = conversation.isGroup
    ? `${(conversation.participants ?? []).length} thành viên`
    : otherParticipant?.email
      ? `Email: ${otherParticipant.email}`
      : 'Trò chuyện trực tiếp';

  const updatedAt =
    conversation.lastMessageAt ?? conversation.updatedAt ?? conversation.createdAt;

  const avatarSource = conversation.isGroup ? title : otherParticipant?.username ?? title;

  return {
    id: conversation._id,
    title,
    subtitle,
    avatarFallback: getInitials(avatarSource),
    isGroup: conversation.isGroup,
    updatedAt,
    unreadCount: 0,
    participants,
  };
};

function Chat() {
  const { token, logout, user } = useAuth();
  const [messages, setMessages] = useState<Message[]>([]);
  const [messagesConversationId, setMessagesConversationId] = useState<string | null>(null);
  const [pendingMessages, setPendingMessages] = useState<Map<string, { content: string; error?: string }>>(new Map());
  const [content, setContent] = useState('');
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [messagesError, setMessagesError] = useState<string | null>(null);
  const [selectedConversationId, setSelectedConversationId] = useState<string | null>(null);
  const [isInitialized, setIsInitialized] = useState(false);
  const [conversations, setConversations] = useState<ConversationPreview[]>([]);
  const [friends, setFriends] = useState<FriendSummary[]>([]);
  const [incomingRequests, setIncomingRequests] = useState<FriendRequestPreview[]>([]);
  const [outgoingRequests, setOutgoingRequests] = useState<FriendRequestPreview[]>([]);
  const [userSearchResults, setUserSearchResults] = useState<FriendSummary[]>([]);
  const [searchingUsers, setSearchingUsers] = useState(false);
  const [friendFeedback, setFriendFeedback] = useState<FriendActionFeedback | null>(null);
  const [friendActionPending, setFriendActionPending] = useState(false);
  const [friendSearchError, setFriendSearchError] = useState<string | null>(null);
  const socketRef = useRef<Socket | null>(null);
  const conversationsRef = useRef<ConversationPreview[]>(conversations);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const voiceStreamRef = useRef<MediaStream | null>(null);
  const voiceChunksRef = useRef<Blob[]>([]);
  const voiceMessageBlobRef = useRef<Blob | null>(null);
  const [voiceMessagePending, setVoiceMessagePending] = useState(false);
  const [voiceRecordingReady, setVoiceRecordingReady] = useState(false);

  const assetBaseUrl = useMemo(() => {
    if (API_BASE_URL) {
      return API_BASE_URL.replace(/\/$/, '');
    }
    if (typeof window !== 'undefined') {
      return window.location.origin.replace(/\/$/, '');
    }
    return '';
  }, []);

  const withVoiceUrl = useCallback(
    (message: Message): Message => {
      const voice = message.voiceRecording;
      if (!voice) {
        return { ...message, voiceRecording: voice ?? undefined };
      }

      if (voice.dataUrl) {
        return { ...message, voiceRecording: { ...voice } };
      }

      if (!voice.url) {
        return { ...message, voiceRecording: { ...voice } };
      }

      const isAbsolute = /^https?:\/\//i.test(voice.url);
      const resolvedUrl = isAbsolute
        ? voice.url
        : `${assetBaseUrl}${voice.url.startsWith('/') ? '' : '/'}${voice.url}`;

      return {
        ...message,
        voiceRecording: {
          ...voice,
          url: resolvedUrl,
        },
      };
    },
    [assetBaseUrl],
  );

  const withImageUrl = useCallback(
    (message: Message): Message => {
      const image = message.image;
      if (!image) {
        return { ...message, image: image ?? undefined };
      }

      if (image.dataUrl) {
        return { ...message, image: { ...image } };
      }

      if (!image.url) {
        return { ...message, image: { ...image } };
      }

      const isAbsolute = /^https?:\/\//i.test(image.url);
      const resolvedUrl = isAbsolute
        ? image.url
        : `${assetBaseUrl}${image.url.startsWith('/') ? '' : '/'}${image.url}`;

      return {
        ...message,
        image: {
          ...image,
          url: resolvedUrl,
        },
      };
    },
    [assetBaseUrl],
  );

  const withFileUrl = useCallback(
    (message: Message): Message => {
      const file = message.file;
      if (!file) {
        return { ...message, file: file ?? undefined };
      }

      if (file.dataUrl) {
        return { ...message, file: { ...file } };
      }

      if (!file.url) {
        return { ...message, file: { ...file } };
      }

      const isAbsolute = /^https?:\/\//i.test(file.url);
      const resolvedUrl = isAbsolute
        ? file.url
        : `${assetBaseUrl}${file.url.startsWith('/') ? '' : '/'}${file.url}`;

      return {
        ...message,
        file: {
          ...file,
          url: resolvedUrl,
        },
      };
    },
    [assetBaseUrl],
  );

  const normalizeMessagePayload = useCallback(
    (message: Message) => withFileUrl(withImageUrl(withVoiceUrl(message))),
    [withFileUrl, withImageUrl, withVoiceUrl],
  );

  type RecorderStopDeferred = {
    promise: Promise<void>;
    resolve: () => void;
    reject: (reason?: unknown) => void;
  };

  const recorderStopDeferredRef = useRef<RecorderStopDeferred | null>(null);

  const getOrCreateRecorderStopDeferred = useCallback(() => {
    if (recorderStopDeferredRef.current) {
      return recorderStopDeferredRef.current;
    }
    let resolve!: () => void;
    let reject!: (reason?: unknown) => void;
    const promise = new Promise<void>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    const deferred: RecorderStopDeferred = { promise, resolve, reject };
    recorderStopDeferredRef.current = deferred;
    return deferred;
  }, []);
  const cleanupVoiceStream = useCallback(() => {
    const stream = voiceStreamRef.current;
    if (stream) {
      stream.getTracks().forEach((track) => track.stop());
      voiceStreamRef.current = null;
    }
  }, []);

  const startVoiceMessage = useCallback(async () => {
    if (typeof window === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      const message = 'Trình duyệt của bạn không hỗ trợ ghi âm.';
      console.error(message);
      window.alert(message);
      throw new Error(message);
    }
    if (typeof MediaRecorder === 'undefined') {
      const message = 'Trình duyệt của bạn không hỗ trợ MediaRecorder.';
      console.error(message);
      window.alert(message);
      throw new Error(message);
    }

    try {
      voiceChunksRef.current = [];
      voiceMessageBlobRef.current = null;
      setVoiceRecordingReady(false);
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      voiceStreamRef.current = stream;
      const recorder = new MediaRecorder(stream);
      mediaRecorderRef.current = recorder;

      recorder.ondataavailable = (event: BlobEvent) => {
        if (event.data?.size > 0) {
          voiceChunksRef.current.push(event.data);
        }
      };

      recorder.onstop = () => {
        try {
          if (voiceChunksRef.current.length > 0) {
            voiceMessageBlobRef.current = new Blob(voiceChunksRef.current, {
              type: recorder.mimeType || 'audio/webm',
            });
            setVoiceRecordingReady(true);
          } else {
            voiceMessageBlobRef.current = null;
            setVoiceRecordingReady(false);
          }
        } finally {
          cleanupVoiceStream();
          voiceChunksRef.current = [];
          mediaRecorderRef.current = null;
          recorderStopDeferredRef.current?.resolve();
          recorderStopDeferredRef.current = null;
        }
      };

      recorder.onerror = (event) => {
        console.error('MediaRecorder error:', event);
        recorderStopDeferredRef.current?.reject(
          (event as { error?: unknown })?.error ?? event,
        );
        recorderStopDeferredRef.current = null;
        cleanupVoiceStream();
        mediaRecorderRef.current = null;
        voiceChunksRef.current = [];
        voiceMessageBlobRef.current = null;
        setVoiceRecordingReady(false);
      };

      recorder.start();
    } catch (error) {
      cleanupVoiceStream();
      mediaRecorderRef.current = null;
      voiceChunksRef.current = [];
      setVoiceRecordingReady(false);
      const message =
        error instanceof DOMException && error.name === 'NotAllowedError'
          ? 'Bạn đã từ chối quyền micro. Vui lòng cho phép trong cài đặt trình duyệt.'
          : 'Không thể truy cập micro. Vui lòng kiểm tra quyền trong trình duyệt.';
      console.error('startVoiceMessage error:', error);
      window.alert(message);
      throw error;
    }
  }, [cleanupVoiceStream]);

  const stopVoiceMessage = useCallback(async () => {
    const recorder = mediaRecorderRef.current;
    if (recorder && recorder.state !== 'inactive') {
      const deferred = getOrCreateRecorderStopDeferred();
      recorder.stop();
      await deferred.promise;
    }
    return Boolean(voiceMessageBlobRef.current);
  }, [getOrCreateRecorderStopDeferred]);

  const cancelVoiceMessage = useCallback(async () => {
    const recorder = mediaRecorderRef.current;
    if (recorder && recorder.state !== 'inactive') {
      const deferred = getOrCreateRecorderStopDeferred();
      recorder.stop();
      try {
        await deferred.promise;
      } catch (error) {
        console.error('cancelVoiceMessage stop error:', error);
      }
    } else {
      cleanupVoiceStream();
    }
    mediaRecorderRef.current = null;
    voiceChunksRef.current = [];
    voiceMessageBlobRef.current = null;
    setVoiceRecordingReady(false);
  }, [cleanupVoiceStream, getOrCreateRecorderStopDeferred]);

  useEffect(() => {
    return () => {
      const recorder = mediaRecorderRef.current;
      if (recorder && recorder.state !== 'inactive') {
        const deferred = getOrCreateRecorderStopDeferred();
        recorder.stop();
        deferred.promise.catch(() => {
          /* ignore */
        });
      }
      cleanupVoiceStream();
    };
  }, [cleanupVoiceStream, getOrCreateRecorderStopDeferred]);

  const updateConversations = useCallback(
    (updater: (prev: ConversationPreview[]) => ConversationPreview[]) => {
      setConversations((prev) => {
        const next = updater(prev);
        conversationsRef.current = next;
        return next;
      });
    },
    [],
  );

  const updateConversationFromMessages = useCallback(
    (conversationId: string | null | undefined, messageList: Message[]) => {
      if (!conversationId) {
        return;
      }
      const latest = messageList.length > 0 ? messageList[messageList.length - 1] : null;

      updateConversations((prev) => {
        const existing = prev.find((conversation) => conversation.id === conversationId);
        const base =
          existing ??
          (latest
            ? {
                id: conversationId,
                title: `Tin nhắn với ${latest.sender ?? 'người dùng'}`,
                subtitle: `Tin nhắn từ ${latest.sender ?? 'người dùng'}`,
                avatarFallback: getInitials(latest.sender ?? 'Chat'),
                isGroup: false,
                unreadCount: 0,
              }
            : {
                id: conversationId,
                title: 'Cuộc trò chuyện',
                subtitle: 'Tin nhắn mới',
                avatarFallback: 'C',
                isGroup: false,
                unreadCount: 0,
              });

        const list = existing ? prev : [...prev, base];

        const next = list.map((conversation) =>
          conversation.id !== conversationId
            ? conversation
            : {
                ...conversation,
                title: conversation.title || base.title,
                subtitle: conversation.subtitle ?? base.subtitle,
                avatarFallback: conversation.avatarFallback ?? base.avatarFallback,
                lastMessageSnippet: latest ? buildSenderSnippet(latest) : conversation.lastMessageSnippet,
                updatedAt: latest?.createdAt ?? conversation.updatedAt,
                unreadCount: 0,
              },
        );

        return sortConversations(next);
      });
    },
    [updateConversations],
  );

  const updateConversationPreviewFromMessage = useCallback(
    (conversationId: string | null | undefined, message: Message, resetUnread: boolean) => {
      if (!conversationId) {
        return;
      }
      updateConversations((prev) => {
        const existing = prev.find((conversation) => conversation.id === conversationId);
        const base =
          existing ??
          {
            id: conversationId,
            title: `Cuộc trò chuyện với ${message.sender ?? 'người dùng'}`,
            subtitle: `Tin nhắn từ ${message.sender ?? 'người dùng'}`,
            avatarFallback: getInitials(message.sender ?? 'Chat'),
            isGroup: false,
            unreadCount: 0,
          };

        const list = existing ? prev : [...prev, base];

        const next = list.map((conversation) =>
          conversation.id !== conversationId
            ? conversation
            : {
                ...conversation,
                title: conversation.title || base.title,
                subtitle: conversation.subtitle ?? base.subtitle,
                avatarFallback: conversation.avatarFallback ?? base.avatarFallback,
                lastMessageSnippet: buildSenderSnippet(message),
                updatedAt: message.createdAt,
                unreadCount: resetUnread ? 0 : (conversation.unreadCount ?? 0) + 1,
              },
        );

        return sortConversations(next);
      });
    },
    [updateConversations],
  );

  const clearFriendFeedback = useCallback(() => {
    setFriendFeedback(null);
  }, []);

  const fetchFriends = useCallback(async () => {
    if (!token) {
      return;
    }
    try {
      const response = await fetch(`${API_BASE_URL}/api/friends`, {
        headers: { ...authHeaders() },
      });
      const data: { friends?: FriendSummary[]; error?: string } = await response.json();
      if (!response.ok) {
        throw new Error(data?.error ?? 'Không thể tải danh sách bạn bè');
      }
      const friendsList = data.friends ?? [];
      
      // Fetch online users and update friends status
      try {
        const onlineResponse = await fetch(`${API_BASE_URL}/api/users/online`, {
          headers: { ...authHeaders() },
        });
        if (onlineResponse.ok) {
          const onlineData: { onlineUserIds?: string[] } = await onlineResponse.json();
          const onlineIds = new Set(onlineData.onlineUserIds ?? []);
          const friendsWithStatus = friendsList.map(friend => ({
            ...friend,
            isOnline: onlineIds.has(friend.id),
          }));
          setFriends(friendsWithStatus);
        } else {
          setFriends(friendsList);
        }
      } catch {
        setFriends(friendsList);
      }
    } catch (err) {
      console.error('fetchFriends error:', err);
    }
  }, [token]);

  const fetchFriendRequests = useCallback(async () => {
    if (!token) {
      return;
    }
    try {
      const response = await fetch(`${API_BASE_URL}/api/friends/requests`, {
        headers: { ...authHeaders() },
      });
      const data: {
        incoming?: FriendRequestPreview[];
        outgoing?: FriendRequestPreview[];
        error?: string;
      } = await response.json();
      if (!response.ok) {
        throw new Error(data?.error ?? 'Không thể tải lời mời kết bạn');
      }
      setIncomingRequests(data.incoming ?? []);
      setOutgoingRequests(data.outgoing ?? []);
    } catch (err) {
      console.error('fetchFriendRequests error:', err);
    }
  }, [token]);

  const searchUsers = useCallback(
    async (query: string) => {
      if (!token) {
        setUserSearchResults([]);
        return;
      }
      const trimmed = query.trim();
      if (trimmed.length === 0) {
        setUserSearchResults([]);
        setFriendSearchError(null);
        return;
      }
      setSearchingUsers(true);
      setFriendSearchError(null);
      try {
        const response = await fetch(
          `${API_BASE_URL}/api/users/search?q=${encodeURIComponent(trimmed)}`,
          { headers: { ...authHeaders() } },
        );
        const data: { results?: FriendSummary[]; error?: string } = await response.json();
        if (!response.ok) {
          throw new Error(data?.error ?? 'Không thể tìm kiếm người dùng');
        }
        const excludeIds = new Set<string>([
          ...friends.map((friend) => friend.id),
          ...incomingRequests.map((request) => request.user.id),
          ...outgoingRequests.map((request) => request.user.id),
        ]);
        const filtered = (data.results ?? []).filter((user) => !excludeIds.has(user.id));
        setUserSearchResults(filtered);
      } catch (err) {
        const message =
          err instanceof Error ? err.message : 'Không thể tìm kiếm người dùng';
        setFriendSearchError(message);
        setUserSearchResults([]);
      } finally {
        setSearchingUsers(false);
      }
    },
    [token, friends, incomingRequests, outgoingRequests],
  );

  const sendFriendRequest = useCallback(
    async ({ userId, email }: FriendRequestTarget) => {
      if (!token) {
        setFriendFeedback({ type: 'error', message: 'Vui lòng đăng nhập lại' });
        return;
      }

      const trimmedEmail = email?.trim();
      if (!userId && !trimmedEmail) {
        setFriendFeedback({
          type: 'error',
          message: 'Vui lòng nhập email hợp lệ hoặc chọn người dùng',
        });
        return;
      }
      setFriendActionPending(true);
      setFriendFeedback(null);
      try {
        const headers: Record<string, string> = {
          'Content-Type': 'application/json',
          ...authHeaders(),
        };
        if (!headers.Authorization) {
          setFriendFeedback({ type: 'error', message: 'Token không hợp lệ. Vui lòng đăng nhập lại' });
          setFriendActionPending(false);
          return;
        }
        const payload: Record<string, string> = {};
        if (userId) {
          payload.targetId = userId;
        } else if (trimmedEmail) {
          payload.targetEmail = trimmedEmail.toLowerCase();
        }
        const response = await fetch(`${API_BASE_URL}/api/friends/requests`, {
          method: 'POST',
          headers,
          body: JSON.stringify(payload),
        });
        const data: {
          message?: string;
          error?: string;
        } = await response.json();
        if (!response.ok) {
          if (response.status === 401) {
            logout();
            throw new Error('Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại');
          }
          throw new Error(data?.error ?? 'Không thể gửi lời mời');
        }
        setFriendFeedback({
          type: 'success',
          message:
            data.message ??
            (trimmedEmail ? `Đã gửi lời mời tới ${trimmedEmail}` : 'Đã gửi lời mời kết bạn'),
        });
        if (userId) {
          setUserSearchResults((prev) => prev.filter((user) => user.id !== userId));
        }
        await Promise.all([fetchFriendRequests(), fetchFriends()]);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Không thể gửi lời mời';
        setFriendFeedback({ type: 'error', message });
        console.error('sendFriendRequest error:', err);
      } finally {
        setFriendActionPending(false);
      }
    },
    [token, fetchFriendRequests, fetchFriends, logout],
  );

  const respondFriendRequest = useCallback(
    async (requestId: string, action: 'accept' | 'decline') => {
      if (!token) {
        return;
      }
      setFriendActionPending(true);
      setFriendFeedback(null);
      try {
        const response = await fetch(
          `${API_BASE_URL}/api/friends/requests/${requestId}/respond`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...authHeaders() },
            body: JSON.stringify({ action }),
          },
        );
        const data: {
          message?: string;
          error?: string;
          friend?: FriendSummary;
        } = await response.json();
        if (!response.ok) {
          throw new Error(data?.error ?? 'Không thể xử lý lời mời');
        }
        setFriendFeedback({
          type: 'success',
          message:
            data.message ??
            (action === 'accept'
              ? 'Đã chấp nhận lời mời kết bạn'
              : 'Đã từ chối lời mời kết bạn'),
        });
        if (data.friend) {
          setUserSearchResults((prev) => prev.filter((user) => user.id !== data.friend?.id));
        }
        await Promise.all([fetchFriendRequests(), fetchFriends()]);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Không thể xử lý lời mời';
        setFriendFeedback({ type: 'error', message });
        console.error('respondFriendRequest error:', err);
      } finally {
        setFriendActionPending(false);
      }
    },
    [token, fetchFriendRequests, fetchFriends],
  );

  const cancelFriendRequest = useCallback(
    async (requestId: string) => {
      if (!token) {
        return;
      }
      setFriendActionPending(true);
      setFriendFeedback(null);
      try {
        const response = await fetch(
          `${API_BASE_URL}/api/friends/requests/${requestId}/cancel`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...authHeaders() },
          },
        );
        const data: { message?: string; error?: string } = await response.json();
        if (!response.ok) {
          throw new Error(data?.error ?? 'Không thể huỷ lời mời');
        }
        setFriendFeedback({
          type: 'success',
          message: data.message ?? 'Đã huỷ lời mời kết bạn',
        });
        await fetchFriendRequests();
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Không thể huỷ lời mời';
        setFriendFeedback({ type: 'error', message });
        console.error('cancelFriendRequest error:', err);
      } finally {
        setFriendActionPending(false);
      }
    },
    [token, fetchFriendRequests],
  );

  const fetchConversations = useCallback(async () => {
    if (!token) return;
    try {
      const response = await fetch(`${API_BASE_URL}/api/conversations`, {
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
      });
      if (!response.ok) {
        throw new Error('Không thể tải danh sách cuộc trò chuyện');
      }
      const data: ConversationResponse[] = await response.json();

      const mapped = data.map((item) => mapConversationResponse(item, user?.id));
      const sorted = sortConversations(mapped);
      updateConversations(() => sorted);

      // Auto-select first conversation if none is selected
      setSelectedConversationId((prev) => {
        // Keep current selection if it still exists
        if (prev && sorted.some((conversation) => conversation.id === prev)) {
          return prev;
        }
        // Auto-select first conversation if available
        if (sorted.length > 0) {
          return sorted[0].id;
        }
        // Only clear if we really have no conversations
        return null;
      });

      if (sorted.length === 0) {
        setMessages([]);
        setLoading(false);
      }
      
      setIsInitialized(true);
    } catch (err) {
      console.error('fetchConversations error:', err);
      setIsInitialized(true);
    }
  }, [token, updateConversations, user?.id]);

  const fetchMessages = useCallback(
    async ({
      silent = false,
      conversationId,
    }: {
      silent?: boolean;
      conversationId?: string | null;
    } = {}) => {
      if (!token) return;

      const targetConversationId = conversationId ?? selectedConversationId;

      if (!targetConversationId) {
        setMessages([]);
        setMessagesConversationId(null);
        if (!silent) {
          setLoading(false);
        }
        return;
      }

      if (!silent) {
        setLoading(true);
      }
      if (targetConversationId === selectedConversationId) {
        setMessagesError(null);
      }

      try {
        const socket = socketRef.current;

        if (socket?.connected) {
          try {
            const data = await new Promise<Message[]>((resolve, reject) => {
              socket
                .timeout(10000)
                .emit(
                  'message:list',
                  { token: getToken(), conversationId: targetConversationId },
                  (err: unknown, response: unknown) => {
                    if (err) {
                      const error =
                        err instanceof Error ? err : new Error('Timeout khi tải tin nhắn');
                      reject(error);
                      return;
                    }
                    const payload = response as
                      | { status: 'ok'; data: Message[] }
                      | { status: 'error'; error?: string };
                    if (payload?.status === 'ok') {
                      resolve(payload.data);
                    } else {
                      reject(new Error(payload?.error ?? 'Không thể tải danh sách tin nhắn'));
                    }
                  },
                );
            });
            const normalized = data.map((msg) => normalizeMessagePayload(msg));
            const sorted = sortMessagesAsc(normalized);
            setMessages(sorted);
            setMessagesConversationId(targetConversationId);
            updateConversationFromMessages(targetConversationId, sorted);
            if (targetConversationId === selectedConversationId) {
              setMessagesError(null);
            }
          } catch (socketError) {
            // Fallback to HTTP if socket fails
            console.warn('Socket fetch failed, falling back to HTTP:', socketError);
            const endpoint = `${API_BASE_URL}/api/messages?conversationId=${encodeURIComponent(
              targetConversationId,
            )}`;
            const response = await fetch(endpoint, {
              headers: { 'Content-Type': 'application/json', ...authHeaders() },
            });
            if (!response.ok) throw new Error('Không thể tải danh sách tin nhắn');
            const data: Message[] = await response.json();
            const normalized = data.map((msg) => normalizeMessagePayload(msg));
            const sorted = sortMessagesAsc(normalized);
            setMessages(sorted);
            setMessagesConversationId(targetConversationId);
            updateConversationFromMessages(targetConversationId, sorted);
            if (targetConversationId === selectedConversationId) {
              setMessagesError(null);
            }
          }
        } else {
          const endpoint = `${API_BASE_URL}/api/messages?conversationId=${encodeURIComponent(
            targetConversationId,
          )}`;
          const response = await fetch(endpoint, {
            headers: { 'Content-Type': 'application/json', ...authHeaders() },
          });
          if (!response.ok) throw new Error('Không thể tải danh sách tin nhắn');
          const data: Message[] = await response.json();
          const normalized = data.map((msg) => normalizeMessagePayload(msg));
          const sorted = sortMessagesAsc(normalized);
          setMessages(sorted);
          setMessagesConversationId(targetConversationId);
          updateConversationFromMessages(targetConversationId, sorted);
          if (targetConversationId === selectedConversationId) {
            setMessagesError(null);
          }
        }
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : 'Không thể tải danh sách tin nhắn';
        if (targetConversationId === selectedConversationId) {
          setMessagesError(errorMessage);
        }
        console.error('fetchMessages error:', err);
      } finally {
        if (!silent) {
          setLoading(false);
        }
      }
    },
    [selectedConversationId, token, updateConversationFromMessages, normalizeMessagePayload],
  );

  const markConversationAsSeen = useCallback(
    async (conversationId: string, messageIds: string[]) => {
      if (!token || !user?.id) {
        return;
      }
      if (!conversationId || messageIds.length === 0) {
        return;
      }

      const viewerId = user.id;
      setMessages((prev) =>
        prev.map((message) => {
          if (!messageIds.includes(message._id)) {
            return message;
          }
          const seenSet = new Set((message.seenBy ?? []).map(String));
          if (seenSet.has(viewerId)) {
            return message;
          }
          seenSet.add(viewerId);
          return { ...message, seenBy: Array.from(seenSet) };
        }),
      );

      try {
        await fetch(`${API_BASE_URL}/api/messages/seen`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...authHeaders() },
          body: JSON.stringify({ conversationId, messageIds }),
        });
      } catch (error) {
        console.error('markConversationAsSeen error:', error);
      }
    },
    [token, user?.id],
  );

  const handleIncomingMessage = useCallback(
    (message: Message) => {
      const normalizedMessage = normalizeMessagePayload(message);
      normalizedMessage.seenBy = normalizedMessage.seenBy ?? [];
      const rawConversationId =
        typeof normalizedMessage.conversation === 'string'
          ? normalizedMessage.conversation.trim()
          : null;
      const conversationId = rawConversationId || selectedConversationId;

      if (!conversationId) {
        return;
      }

      const existed = conversationsRef.current.some(
        (conversation) => conversation.id === conversationId,
      );
      const isCurrent = conversationId === selectedConversationId;

      if (isCurrent) {
        setMessagesConversationId(conversationId);
        setMessages((prev) => {
          const exists = prev.some((item) => item._id === normalizedMessage._id);
          if (exists) return prev;
          return sortMessagesAsc([...prev, normalizedMessage]);
        });
      }

      updateConversationPreviewFromMessage(conversationId, normalizedMessage, isCurrent);

      if (!existed && rawConversationId) {
        void fetchConversations();
      }
    },
    [fetchConversations, selectedConversationId, updateConversationPreviewFromMessage, normalizeMessagePayload],
  );

  const handleMessageSeen = useCallback(
    (payload: { conversationId?: string; viewerId?: string; messageIds?: string[] }) => {
      if (!payload || !payload.viewerId || !Array.isArray(payload.messageIds) || payload.messageIds.length === 0) {
        return;
      }
      if (payload.conversationId && selectedConversationId && payload.conversationId !== selectedConversationId) {
        return;
      }
      const viewerId = payload.viewerId as string;
      setMessages((prev) =>
        prev.map((message) => {
          if (!payload.messageIds?.includes(message._id)) {
            return message;
          }
          const seenSet = new Set((message.seenBy ?? []).map(String));
          if (seenSet.has(viewerId)) {
            return message;
          }
          seenSet.add(viewerId);
          return { ...message, seenBy: Array.from(seenSet) };
        }),
      );
    },
    [selectedConversationId],
  );

  const sendImageMessage = useCallback(async (file: File) => {
    if (!selectedConversationId) {
      window.alert('Vui lòng chọn một cuộc trò chuyện để gửi hình ảnh.');
      return;
    }
    if (!token) {
      window.alert('Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.');
      return;
    }
    const conversationId = selectedConversationId as string;

    try {
      const fileName = file.name || `image-${Date.now()}.jpg`;
      const endpoint = `${API_BASE_URL}/api/messages/image?conversationId=${encodeURIComponent(
        conversationId,
      )}`;

      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          ...authHeaders(),
          'X-Image-Filename': fileName,
        },
        body: file,
      });

      // Check if response is JSON before parsing
      const contentType = response.headers.get('content-type');
      let payload: Message & { error?: string };
      
      if (!contentType || !contentType.includes('application/json')) {
        const text = await response.text();
        console.error('Non-JSON response:', text.substring(0, 200));
        if (!response.ok) {
          throw new Error(`Server error: ${response.status} ${response.statusText}`);
        }
        throw new Error('Server trả về lỗi không hợp lệ. Vui lòng thử lại.');
      }

      try {
        payload = (await response.json()) as Message & { error?: string };
      } catch (parseError) {
        console.error('JSON parse error:', parseError);
        const text = await response.text();
        console.error('Response text:', text.substring(0, 200));
        throw new Error('Không thể đọc phản hồi từ server.');
      }

      if (!response.ok) {
        const errorMessage = payload?.error ?? `Gửi hình ảnh thất bại (${response.status})`;
        throw new Error(errorMessage);
      }

      const normalized = normalizeMessagePayload(payload);
      handleIncomingMessage(normalized);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Gửi hình ảnh thất bại';
      console.error('sendImageMessage error:', error);
      window.alert(message);
    }
  }, [handleIncomingMessage, normalizeMessagePayload, selectedConversationId, token]);

  const sendFileMessage = useCallback(async (file: File) => {
    if (!selectedConversationId) {
      window.alert('Vui lòng chọn một cuộc trò chuyện để gửi tệp.');
      return;
    }
    if (!token) {
      window.alert('Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.');
      return;
    }
    const conversationId = selectedConversationId as string;

    try {
      const fileName = file.name || `file-${Date.now()}`;
      const endpoint = `${API_BASE_URL}/api/messages/file?conversationId=${encodeURIComponent(
        conversationId,
      )}`;

      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          ...authHeaders(),
          'X-File-Filename': fileName,
        },
        body: file,
      });

      const contentType = response.headers.get('content-type');
      let payload: Message & { error?: string };

      if (!contentType || !contentType.includes('application/json')) {
        const text = await response.text();
        console.error('Non-JSON response:', text.substring(0, 200));
        if (!response.ok) {
          throw new Error(`Server error: ${response.status} ${response.statusText}`);
        }
        throw new Error('Server trả về lỗi không hợp lệ. Vui lòng thử lại.');
      }

      try {
        payload = (await response.json()) as Message & { error?: string };
      } catch (parseError) {
        console.error('JSON parse error:', parseError);
        const text = await response.text();
        console.error('Response text:', text.substring(0, 200));
        throw new Error('Không thể đọc phản hồi từ server.');
      }

      if (!response.ok) {
        const errorMessage = payload?.error ?? `Gửi tệp thất bại (${response.status})`;
        throw new Error(errorMessage);
      }

      const normalized = normalizeMessagePayload(payload);
      handleIncomingMessage(normalized);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Gửi tệp thất bại';
      console.error('sendFileMessage error:', error);
      window.alert(message);
    }
  }, [handleIncomingMessage, normalizeMessagePayload, selectedConversationId, token]);

  const sendVoiceMessage = useCallback(async () => {
    const blob = voiceMessageBlobRef.current;
    if (!blob) {
      window.alert('Không có ghi âm để gửi. Vui lòng thử lại.');
      return;
    }
    if (!selectedConversationId) {
      window.alert('Vui lòng chọn một cuộc trò chuyện để gửi tin nhắn thoại.');
      return;
    }
    if (!token) {
      window.alert('Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.');
      return;
    }

    setVoiceMessagePending(true);
    try {
      const fileName = `voice-message-${Date.now()}.webm`;
      const endpoint = `${API_BASE_URL}/api/messages/voice?conversationId=${encodeURIComponent(
        selectedConversationId,
      )}`;

      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          ...authHeaders(),
          'Content-Type': blob.type || 'audio/webm',
          'X-Audio-Filename': fileName,
        },
        body: blob,
      });

      const payload = (await response.json()) as Message & { error?: string };
      if (!response.ok) {
        const errorMessage = payload?.error ?? 'Gửi tin nhắn thoại thất bại';
        throw new Error(errorMessage);
      }

      const normalized = normalizeMessagePayload(payload);
      handleIncomingMessage(normalized);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Gửi tin nhắn thoại thất bại';
      console.error('sendVoiceMessage error:', error);
      window.alert(message);
    } finally {
      setVoiceMessagePending(false);
      voiceChunksRef.current = [];
      voiceMessageBlobRef.current = null;
      setVoiceRecordingReady(false);
    }
  }, [handleIncomingMessage, normalizeMessagePayload, selectedConversationId, token]);

  const startConversationWithFriend = useCallback(
    async (friendId: string) => {
      if (!token) {
        return;
      }
      setFriendActionPending(true);
      setFriendFeedback(null);
      try {
      const response = await fetch(`${API_BASE_URL}/api/conversations/direct`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...authHeaders(),
        },
        body: JSON.stringify({ friendId, includeSelf: false }),
      });
        const data: ConversationResponse & { error?: string } = await response.json();
        if (!response.ok) {
          throw new Error(data?.error ?? 'Không thể mở cuộc trò chuyện');
        }
        const preview = mapConversationResponse(data, user?.id);
        updateConversations((prev) => {
          const others = prev.filter((conversation) => conversation.id !== preview.id);
          return sortConversations([...others, preview]);
        });
        setSelectedConversationId(preview.id);
        setFriendFeedback({
          type: 'success',
          message: 'Đã mở cuộc trò chuyện riêng',
        });
        await fetchMessages({ conversationId: preview.id });
      } catch (err) {
        const message =
          err instanceof Error ? err.message : 'Không thể mở cuộc trò chuyện';
        setFriendFeedback({ type: 'error', message });
        console.error('startConversationWithFriend error:', err);
      } finally {
        setFriendActionPending(false);
      }
    },
    [token, user?.id, updateConversations, fetchMessages],
  );

  const createGroupConversation = useCallback(
    async ({ name, memberIds }: { name: string; memberIds: string[] }) => {
      if (!token) {
        return;
      }
      setFriendActionPending(true);
      setFriendFeedback(null);
      try {
        const response = await fetch(`${API_BASE_URL}/api/conversations/group`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...authHeaders() },
          body: JSON.stringify({ name: name.trim(), memberIds }),
        });
        const data: (ConversationResponse & { error?: string }) = await response.json();
        if (!response.ok) {
          throw new Error(data?.error ?? 'Không thể tạo nhóm');
        }
        const preview = mapConversationResponse(data, user?.id);
        updateConversations((prev) => sortConversations([...prev, preview]));
        setSelectedConversationId(preview.id);
        setFriendFeedback({
          type: 'success',
          message: 'Đã tạo nhóm trò chuyện mới',
        });
        await fetchMessages({ conversationId: preview.id });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Không thể tạo nhóm';
        setFriendFeedback({ type: 'error', message });
        throw new Error(message);
      } finally {
        setFriendActionPending(false);
      }
    },
    [token, user?.id, updateConversations, fetchMessages],
  );

  const chatMessages = useMemo<ChatMessage[]>(() => {
    const result: ChatMessage[] = messages.map((message) => ({
      id: message._id,
      content: message.content,
      sender: message.sender,
      senderId: message.senderId ?? undefined,
      createdAt: message.createdAt,
      messageType: message.messageType ?? 'text',
      voiceRecording: message.voiceRecording ?? undefined,
      image: message.image ?? undefined,
      file: message.file ?? undefined,
      seenBy: message.seenBy ?? [],
    }));

    // Add pending messages with errors
    pendingMessages.forEach((pending, tempId) => {
      if (pending.error) {
        result.push({
          id: tempId,
          content: pending.content,
          sender: user?.username ?? 'Bạn',
          senderId: user?.id,
          createdAt: new Date().toISOString(),
          error: pending.error,
          isPending: false,
          messageType: 'text',
          seenBy: [],
        });
      }
    });

    return result.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
  }, [messages, pendingMessages, user?.username, user?.id]);

  const handleSelectConversation = useCallback((id: string) => {
    if (id === selectedConversationId) return; // Avoid unnecessary re-renders
    setSelectedConversationId(id);
    setContent('');
    setMessagesError(null);
    // Clear pending messages when switching conversations
    setPendingMessages(new Map());
  }, [selectedConversationId]);

  useEffect(() => {
    if (!selectedConversationId) return;
    updateConversations((prev) =>
      prev.map((conversation) =>
        conversation.id !== selectedConversationId ? conversation : { ...conversation, unreadCount: 0 },
      ),
    );
  }, [selectedConversationId, updateConversations]);

  // Removed duplicate auto-select logic - handled in fetchConversations

  useEffect(() => {
    if (!token) return;
    fetchConversations();
  }, [token, fetchConversations]);

  useEffect(() => {
    if (!token) {
      setMessages([]);
      setMessagesConversationId(null);
      setSelectedConversationId(null);
      setFriends([]);
      setIncomingRequests([]);
      setOutgoingRequests([]);
      setUserSearchResults([]);
      setFriendFeedback(null);
      setFriendSearchError(null);
      setFriendActionPending(false);
      setSearchingUsers(false);
      return;
    }
    fetchFriends();
    fetchFriendRequests();
  }, [token, fetchFriends, fetchFriendRequests]);

  useEffect(() => {
    if (userSearchResults.length === 0) return;
    const excludeIds = new Set<string>([
      ...friends.map((friend) => friend.id),
      ...incomingRequests.map((request) => request.user.id),
      ...outgoingRequests.map((request) => request.user.id),
    ]);
    setUserSearchResults((prev) => prev.filter((user) => !excludeIds.has(user.id)));
  }, [friends, incomingRequests, outgoingRequests, userSearchResults.length]);

  useEffect(() => {
    if (!selectedConversationId || !user?.id) {
      return;
    }
    if (messagesConversationId && messagesConversationId !== selectedConversationId) {
      return;
    }
    const viewerId = user.id;
    const normalizedUsername = (user.username ?? '').toLowerCase();
    const unseenMessageIds = messages
      .filter((message) => {
        const senderId = message.senderId;
        const senderName = (message.sender ?? '').toLowerCase();
        const isOwnMessage =
          (senderId && senderId === viewerId) ||
          (!senderId && normalizedUsername && senderName === normalizedUsername);
        if (isOwnMessage) {
          return false;
        }
        const seenBy = (message.seenBy ?? []).map(String);
        return !seenBy.includes(viewerId);
      })
      .map((message) => message._id);
    if (unseenMessageIds.length > 0) {
      markConversationAsSeen(selectedConversationId, unseenMessageIds);
    }
  }, [messages, selectedConversationId, markConversationAsSeen, user?.id, user?.username, messagesConversationId]);

  useEffect(() => {
    if (!token) return;
    if (!selectedConversationId) {
      setMessages([]);
      setMessagesConversationId(null);
      setLoading(false);
      setMessagesError(null);
      return;
    }
    // Only fetch messages if initialized to avoid race conditions
    if (isInitialized) {
      setMessages([]);
      setMessagesConversationId(selectedConversationId);
      setMessagesError(null);
      fetchMessages({ conversationId: selectedConversationId });
    }
  }, [token, selectedConversationId, fetchMessages, isInitialized]);

  const handleUserOnline = useCallback((data: { userId: string; username?: string }) => {
    setFriends(prev => prev.map(friend => 
      friend.id === data.userId ? { ...friend, isOnline: true } : friend
    ));
  }, []);

  const handleUserOffline = useCallback((data: { userId: string }) => {
    setFriends(prev => prev.map(friend => 
      friend.id === data.userId ? { ...friend, isOnline: false } : friend
    ));
  }, []);

  // Socket connection - only recreate when token changes
  useEffect(() => {
    if (!token) {
      // Cleanup existing socket if token is removed
      if (socketRef.current) {
        socketRef.current.removeAllListeners();
        socketRef.current.disconnect();
        socketRef.current = null;
      }
      return;
    }

    // Don't recreate socket if it already exists and is connected
    if (socketRef.current) {
      const currentSocket = socketRef.current;
      if (currentSocket.connected) {
        return;
      }
      // If socket exists but disconnected, cleanup first
      currentSocket.removeAllListeners();
      currentSocket.disconnect();
      socketRef.current = null;
    }

    // In development, use proxy path. In production, use full URL
    const socketOptions: any = {
      transports: ['websocket', 'polling'], // Allow fallback to polling
      withCredentials: true,
      reconnection: true,
      reconnectionAttempts: 5,
      reconnectionDelay: 1000,
      timeout: 20000,
    };
    
    // In development (using proxy), Socket.IO will connect to /socket.io
    // In production, connect directly to backend URL
    const socket = import.meta.env.PROD
      ? io(SOCKET_URL, socketOptions)
      : io(SOCKET_URL, { ...socketOptions, path: '/socket.io' });
    
    socketRef.current = socket;
    let isCleanedUp = false;

    // Authenticate user when socket connects
    const handleConnect = () => {
      if (isCleanedUp) return;
      const currentToken = localStorage.getItem('token');
      if (currentToken) {
        socket.emit('user:authenticate', { token: currentToken });
      }
    };

    socket.on('connect', handleConnect);
    socket.on('message:new', handleIncomingMessage);
    socket.on('user:online', handleUserOnline);
    socket.on('user:offline', handleUserOffline);
    socket.on('message:seen', handleMessageSeen);

    if (socket.connected) {
      handleConnect();
    }

    return () => {
      isCleanedUp = true;
      if (socketRef.current === socket) {
        socket.removeAllListeners();
        // Only disconnect if socket is actually connected
        if (socket.connected) {
          socket.disconnect();
        }
        socketRef.current = null;
      }
    };
  }, [token]); // Only depend on token - socket should persist

  // Update handlers when they change (but don't recreate socket)
  useEffect(() => {
    const socket = socketRef.current;
    if (!socket || !token) return;

    // Update handlers by removing and re-adding
    socket.off('message:new');
    socket.off('user:online');
    socket.off('user:offline');
    socket.off('message:seen');

    socket.on('message:new', handleIncomingMessage);
    socket.on('user:online', handleUserOnline);
    socket.on('user:offline', handleUserOffline);
    socket.on('message:seen', handleMessageSeen);
  }, [token, handleIncomingMessage, handleUserOnline, handleUserOffline, handleMessageSeen]);


  const sendMessage = async () => {
    if (!content.trim()) {
      return;
    }

    if (!selectedConversationId) {
      return;
    }

    const messageContent = content.trim();
    const tempId = `pending-${Date.now()}-${Math.random()}`;
    
    // Add pending message
    setPendingMessages((prev) => {
      const next = new Map(prev);
      next.set(tempId, { content: messageContent, error: undefined });
      return next;
    });

    setSubmitting(true);
    setContent('');

    try {
      const payload = {
        token: getToken(),
        content: messageContent,
        conversationId: selectedConversationId,
      };
      const socket = socketRef.current;
      if (socket?.connected) {
        try {
          const message = await new Promise<Message>((resolve, reject) => {
            socket
              .timeout(10000)
              .emit('message:send', payload, (err: unknown, response: unknown) => {
                if (err) {
                  const error =
                    err instanceof Error ? err : new Error('Timeout khi gửi tin nhắn');
                  reject(error);
                  return;
                }
                const data = response as
                  | { status: 'ok'; data: Message }
                  | { status: 'error'; error?: string };
                if (data?.status === 'ok' && data.data) {
                  resolve(data.data);
                } else {
                  const errorData = data as { status: 'error'; error?: string };
                  reject(new Error(errorData?.error ?? 'Không thể gửi tin nhắn'));
                }
              });
          });
          // Remove pending message and add the real one
          setPendingMessages((prev) => {
            const next = new Map(prev);
            next.delete(tempId);
            return next;
          });
          // Manually add message to current view since socket event might be delayed
          handleIncomingMessage(message);
        } catch (socketError) {
          console.warn('Socket send failed, falling back to HTTP:', socketError);
          const response = await fetch(`${API_BASE_URL}/api/messages`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...authHeaders() },
            body: JSON.stringify(payload),
          });
          if (!response.ok) {
            const errorData = await response.json().catch(() => ({ error: 'Không thể gửi tin nhắn' }));
            throw new Error(errorData?.error ?? 'Không thể gửi tin nhắn');
          }
          const message: Message = await response.json();
          // Remove pending message and add the real one
          setPendingMessages((prev) => {
            const next = new Map(prev);
            next.delete(tempId);
            return next;
          });
          handleIncomingMessage(message);
        }
      } else {
        const response = await fetch(`${API_BASE_URL}/api/messages`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...authHeaders() },
          body: JSON.stringify(payload),
        });
        if (!response.ok) {
          const errorData = await response.json().catch(() => ({ error: 'Không thể gửi tin nhắn' }));
          throw new Error(errorData?.error ?? 'Không thể gửi tin nhắn');
        }
        const message: Message = await response.json();
        // Remove pending message and add the real one
        setPendingMessages((prev) => {
          const next = new Map(prev);
          next.delete(tempId);
          return next;
        });
        handleIncomingMessage(message);
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Lỗi không xác định';
      // Mark pending message as failed
      setPendingMessages((prev) => {
        const next = new Map(prev);
        const existing = next.get(tempId);
        if (existing) {
          next.set(tempId, { ...existing, error: errorMessage });
        }
        return next;
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="flex h-screen flex-col bg-slate-100">
      <div className="flex items-center justify-between border-b border-slate-200 bg-white px-6 py-4 shadow-sm">
        <h1 className="text-lg font-semibold text-slate-900">Chat App</h1>
        <button
          className="rounded-full bg-blue-500 px-4 py-2 text-sm font-medium text-white transition hover:bg-blue-600"
          onClick={logout}
          type="button"
        >
          Đăng xuất
        </button>
      </div>
      <div className="flex-1 min-h-0 overflow-hidden">
        <ChatLayout
          conversations={conversations}
          selectedConversationId={selectedConversationId}
          onSelectConversation={handleSelectConversation}
          messages={chatMessages}
          loading={loading}
          messagesError={messagesError}
          onRetry={() => fetchMessages({ conversationId: selectedConversationId })}
          inputValue={content}
          onInputChange={setContent}
          onSend={sendMessage}
          sending={submitting}
          currentUserName={user?.username}
          currentUserId={user?.id}
          friends={friends}
          incomingRequests={incomingRequests}
          outgoingRequests={outgoingRequests}
          onStartConversationWithFriend={startConversationWithFriend}
          onSendFriendRequest={sendFriendRequest}
          onAcceptFriendRequest={(requestId) => respondFriendRequest(requestId, 'accept')}
          onDeclineFriendRequest={(requestId) => respondFriendRequest(requestId, 'decline')}
          onCancelFriendRequest={cancelFriendRequest}
          searchResults={userSearchResults}
          onSearchUsers={searchUsers}
          searchingUsers={searchingUsers}
          friendFeedback={friendFeedback}
          onClearFriendFeedback={clearFriendFeedback}
          friendActionPending={friendActionPending}
          friendSearchError={friendSearchError}
          onCreateGroupConversation={createGroupConversation}
        onVoiceMessage={startVoiceMessage}
        voiceMessagePending={voiceMessagePending}
        onVoiceMessageStop={stopVoiceMessage}
        onVoiceMessageSend={sendVoiceMessage}
          onVoiceMessageCancel={cancelVoiceMessage}
          voiceRecordingReady={voiceRecordingReady}
          onSendImage={sendImageMessage}
          onSendFile={sendFileMessage}
        />
      </div>
    </div>
  );
}

function AppRoutes() {
  const { token } = useAuth();
  const [view, setView] = useState<'login' | 'register' | 'chat'>(() =>
    token ? 'chat' : 'login',
  );
  const goLogin = useCallback(() => setView('login'), []);
  const goRegister = useCallback(() => setView('register'), []);
  const goChat = useCallback(() => setView('chat'), []);

  useEffect(() => {
    setView(token ? 'chat' : 'login');
  }, [token]);

  return (
    <>
      {view === 'login' && <Login goRegister={goRegister} goChat={goChat} />}
      {view === 'register' && <Register goLogin={goLogin} goChat={goChat} />}
      {view === 'chat' && <Chat />}
    </>
  );
}

function App() {
  return (
    <AuthProvider>
      <AppRoutes />
    </AuthProvider>
  );
}

export default App;


