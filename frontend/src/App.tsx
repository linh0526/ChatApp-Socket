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

type Message = {
  _id: string;
  sender: string;
  content: string;
  createdAt: string;
  conversation?: string | null;
};

type ConversationParticipantResponse = {
  id: string;
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
const SOCKET_URL = API_BASE_URL || window.location.origin.replace(/\/$/, '');

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
  const participants = conversation.participants ?? [];
  const otherParticipant =
    !conversation.isGroup && currentUserId
      ? participants.find((participant) => participant.id !== currentUserId)
      : undefined;

  const title =
    conversation.name?.trim() ||
    (conversation.isGroup ? 'Nhóm chưa đặt tên' : otherParticipant?.username ?? 'Cuộc trò chuyện');

  const subtitle = conversation.isGroup
    ? `${participants.length} thành viên`
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
  };
};

function Chat() {
  const { token, logout, user } = useAuth();
  const [messages, setMessages] = useState<Message[]>([]);
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
      setFriends(data.friends ?? []);
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
            const sorted = sortMessagesAsc(data);
            setMessages(sorted);
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
            const sorted = sortMessagesAsc(data);
            setMessages(sorted);
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
          const sorted = sortMessagesAsc(data);
          setMessages(sorted);
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
    [selectedConversationId, token, updateConversationFromMessages],
  );

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
          headers: { 'Content-Type': 'application/json', ...authHeaders() },
          body: JSON.stringify({ friendId }),
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

  const handleIncomingMessage = useCallback(
    (message: Message) => {
      // Handle messages with or without conversationId
      const rawConversationId =
        typeof message.conversation === 'string' ? message.conversation.trim() : null;
      const conversationId = rawConversationId || selectedConversationId;
      
      if (!conversationId) {
        return;
      }

      const existed = conversationsRef.current.some(
        (conversation) => conversation.id === conversationId,
      );
      const isCurrent = conversationId === selectedConversationId;

      if (isCurrent) {
        setMessages((prev) => {
          const exists = prev.some((item) => item._id === message._id);
          if (exists) return prev;
          return sortMessagesAsc([...prev, message]);
        });
      }

      updateConversationPreviewFromMessage(conversationId, message, isCurrent);

      if (!existed && rawConversationId) {
        void fetchConversations();
      }
    },
    [fetchConversations, selectedConversationId, updateConversationPreviewFromMessage],
  );

  const chatMessages = useMemo<ChatMessage[]>(() => {
    const result: ChatMessage[] = messages.map((message) => ({
      id: message._id,
      content: message.content,
      sender: message.sender,
      createdAt: message.createdAt,
    }));

    // Add pending messages with errors
    pendingMessages.forEach((pending, tempId) => {
      if (pending.error) {
        result.push({
          id: tempId,
          content: pending.content,
          sender: user?.username ?? 'Bạn',
          createdAt: new Date().toISOString(),
          error: pending.error,
          isPending: false,
        });
      }
    });

    return result.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
  }, [messages, pendingMessages, user?.username]);

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
    if (!token) return;
    if (!selectedConversationId) {
      setMessages([]);
      setLoading(false);
      setMessagesError(null);
      return;
    }
    // Only fetch messages if initialized to avoid race conditions
    if (isInitialized) {
      setMessages([]);
      setMessagesError(null);
      fetchMessages({ conversationId: selectedConversationId });
    }
  }, [token, selectedConversationId, fetchMessages, isInitialized]);

  useEffect(() => {
    if (!token) return;
    const socket = io(SOCKET_URL, { transports: ['websocket'], withCredentials: true });
    socketRef.current = socket;

    const handleConnected = () => {
      // Only fetch messages if initialized and have a selected conversation
      if (isInitialized && selectedConversationId) {
        fetchMessages({ silent: true, conversationId: selectedConversationId });
      }
    };

    socket.on('message:new', handleIncomingMessage);
    socket.on('connect', handleConnected);

    if (socket.connected) {
      void handleConnected();
    }

    return () => {
      socket.off('message:new', handleIncomingMessage);
      socket.off('connect', handleConnected);
      socket.disconnect();
      socketRef.current = null;
    };
  }, [token, handleIncomingMessage, fetchMessages, selectedConversationId, isInitialized]);

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


