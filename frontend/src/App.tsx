import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { io, type Socket } from 'socket.io-client';
import { AuthProvider, useAuth } from './AuthContext';
import { authHeaders, getToken } from './auth';
import Login from './pages/Login';
import Register from './pages/Register';
import { ChatLayout, type ConversationPreview } from './ChatLayout';
import type { ChatMessage } from './chatTypes';

type Message = {
  _id: string;
  sender: string;
  content: string;
  createdAt: string;
  conversation?: string | null;
};

type ConversationResponse = {
  _id: string;
  name?: string;
  isGroup?: boolean;
  participants?: string[];
  lastMessageAt?: string;
  updatedAt?: string;
  createdAt?: string;
};

const sortMessagesAsc = (items: Message[]) =>
  [...items].sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());

const API_BASE_URL =
  (import.meta.env.VITE_API_BASE_URL as string | undefined)?.replace(/\/$/, '') ?? '';
const SOCKET_URL = API_BASE_URL || window.location.origin.replace(/\/$/, '');
const GENERAL_CONVERSATION_ID = 'general';

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

const normalizeConversationId = (value?: string | null) =>
  value && value.trim().length > 0 ? value : GENERAL_CONVERSATION_ID;

const GENERAL_CONVERSATION_TEMPLATE: ConversationPreview = {
  id: GENERAL_CONVERSATION_ID,
  title: 'Phòng chung',
  subtitle: 'Trò chuyện với tất cả mọi người',
  avatarFallback: 'GC',
  isGroup: true,
  unreadCount: 0,
};

const createGeneralConversation = (
  overrides: Partial<ConversationPreview> = {},
): ConversationPreview => ({
  ...GENERAL_CONVERSATION_TEMPLATE,
  ...overrides,
});

const sortConversations = (items: ConversationPreview[]) => {
  const unique = new Map<string, ConversationPreview>();
  for (const item of items) {
    unique.set(item.id, item);
  }
  const general = unique.get(GENERAL_CONVERSATION_ID);
  if (general) {
    unique.delete(GENERAL_CONVERSATION_ID);
  }

  const others = Array.from(unique.values()).sort((a, b) => {
    const timeA = a.updatedAt ? new Date(a.updatedAt).getTime() : 0;
    const timeB = b.updatedAt ? new Date(b.updatedAt).getTime() : 0;
    return timeB - timeA;
  });

  return general ? [general, ...others] : others;
};

const mapConversationResponse = (conversation: ConversationResponse): ConversationPreview => {
  const title =
    conversation.name?.trim() ||
    (conversation.isGroup ? 'Nhóm chưa đặt tên' : 'Cuộc trò chuyện');
  const subtitle = conversation.isGroup
    ? `${conversation.participants?.length ?? 0} thành viên`
    : 'Trò chuyện trực tiếp';
  const updatedAt =
    conversation.lastMessageAt ?? conversation.updatedAt ?? conversation.createdAt;

  return {
    id: conversation._id,
    title,
    subtitle,
    avatarFallback: getInitials(title),
    isGroup: conversation.isGroup,
    updatedAt,
    unreadCount: 0,
  };
};

function Chat() {
  const { token, logout, user } = useAuth();
  const [messages, setMessages] = useState<Message[]>([]);
  const [content, setContent] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [selectedConversationId, setSelectedConversationId] = useState<string>(
    GENERAL_CONVERSATION_ID,
  );
  const [conversations, setConversations] = useState<ConversationPreview[]>(() => [
    createGeneralConversation(),
  ]);
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
    (conversationId: string, messageList: Message[]) => {
      const latest = messageList.length > 0 ? messageList[messageList.length - 1] : null;

      updateConversations((prev) => {
        const existing = prev.find((conversation) => conversation.id === conversationId);
        const base =
          conversationId === GENERAL_CONVERSATION_ID
            ? createGeneralConversation(existing ?? {})
            : existing ?? {
                id: conversationId,
                title: 'Cuộc trò chuyện',
                subtitle: latest ? `Tin nhắn từ ${latest.sender ?? 'người dùng'}` : 'Tin nhắn mới',
                avatarFallback: getInitials(latest?.sender ?? 'Chat'),
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
    (conversationId: string, message: Message, resetUnread: boolean) => {
      updateConversations((prev) => {
        const existing = prev.find((conversation) => conversation.id === conversationId);
        const base =
          conversationId === GENERAL_CONVERSATION_ID
            ? createGeneralConversation(existing ?? {})
            : existing ?? {
                id: conversationId,
                title: 'Cuộc trò chuyện',
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

      const existingGeneral =
        conversationsRef.current.find(
          (conversation) => conversation.id === GENERAL_CONVERSATION_ID,
        ) ?? createGeneralConversation();

      const mapped = data.map(mapConversationResponse);
      const mergedMap = new Map<string, ConversationPreview>();
      mergedMap.set(GENERAL_CONVERSATION_ID, { ...existingGeneral });

      for (const item of mapped) {
        const existing = conversationsRef.current.find(
          (conversation) => conversation.id === item.id,
        );
        if (existing) {
          mergedMap.set(item.id, {
            ...existing,
            title: item.title,
            subtitle: item.subtitle ?? existing.subtitle,
            avatarFallback: existing.avatarFallback ?? item.avatarFallback,
            isGroup: item.isGroup,
            updatedAt: item.updatedAt ?? existing.updatedAt,
          });
        } else {
          mergedMap.set(item.id, item);
        }
      }

      const mergedList = Array.from(mergedMap.values());
      const sorted = sortConversations(mergedList);
      updateConversations(() => sorted);

      setSelectedConversationId((prev) => {
        const normalizedPrev = normalizeConversationId(prev);
        if (mergedMap.has(normalizedPrev)) {
          return normalizedPrev;
        }
        const firstActual = sorted.find((conversation) => conversation.id !== GENERAL_CONVERSATION_ID);
        return firstActual?.id ?? GENERAL_CONVERSATION_ID;
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Không thể tải danh sách cuộc trò chuyện');
    }
  }, [token, updateConversations]);

  const fetchMessages = useCallback(
    async ({
      silent = false,
      conversationId,
    }: {
      silent?: boolean;
      conversationId?: string | null;
    } = {}) => {
      if (!token) return;

      const targetConversationId = normalizeConversationId(
        conversationId ?? selectedConversationId,
      );

      if (!silent) {
        setLoading(true);
      }
      setError(null);

      try {
        const socket = socketRef.current;
        const apiConversationId =
          targetConversationId === GENERAL_CONVERSATION_ID ? undefined : targetConversationId;

        if (socket?.connected) {
          const data = await new Promise<Message[]>((resolve, reject) => {
            socket
              .timeout(5000)
              .emit(
                'message:list',
                { token: getToken(), conversationId: apiConversationId },
                (response: unknown) => {
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
        } else {
          const endpoint =
            apiConversationId && apiConversationId.length > 0
              ? `${API_BASE_URL}/api/messages?conversationId=${encodeURIComponent(
                  apiConversationId,
                )}`
              : `${API_BASE_URL}/api/messages`;
          const response = await fetch(endpoint, {
            headers: { 'Content-Type': 'application/json', ...authHeaders() },
          });
          if (!response.ok) throw new Error('Không thể tải danh sách tin nhắn');
          const data: Message[] = await response.json();
          const sorted = sortMessagesAsc(data);
          setMessages(sorted);
          updateConversationFromMessages(targetConversationId, sorted);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Lỗi không xác định');
      } finally {
        if (!silent) {
          setLoading(false);
        }
      }
    },
    [selectedConversationId, token, updateConversationFromMessages],
  );

  const handleIncomingMessage = useCallback(
    (message: Message) => {
      const conversationId = normalizeConversationId(message.conversation);
      const existed = conversationsRef.current.some(
        (conversation) => conversation.id === conversationId,
      );
      const isCurrent = conversationId === normalizeConversationId(selectedConversationId);

      if (isCurrent) {
        setMessages((prev) => {
          const exists = prev.some((item) => item._id === message._id);
          if (exists) return prev;
          return sortMessagesAsc([...prev, message]);
        });
      }

      updateConversationPreviewFromMessage(conversationId, message, isCurrent);

      if (!existed && conversationId !== GENERAL_CONVERSATION_ID) {
        void fetchConversations();
      }
    },
    [fetchConversations, selectedConversationId, updateConversationPreviewFromMessage],
  );

  const chatMessages = useMemo<ChatMessage[]>(
    () =>
      messages.map((message) => ({
        id: message._id,
        content: message.content,
        sender: message.sender,
        createdAt: message.createdAt,
      })),
    [messages],
  );

  const handleSelectConversation = useCallback((id: string) => {
    setSelectedConversationId(id);
    setError(null);
    setContent('');
  }, []);

  useEffect(() => {
    const targetId = normalizeConversationId(selectedConversationId);
    updateConversations((prev) =>
      prev.map((conversation) =>
        conversation.id !== targetId ? conversation : { ...conversation, unreadCount: 0 },
      ),
    );
  }, [selectedConversationId, updateConversations]);

  useEffect(() => {
    if (!token) return;
    fetchConversations();
  }, [token, fetchConversations]);

  useEffect(() => {
    if (!token) return;
    setMessages([]);
    fetchMessages({ conversationId: selectedConversationId });
  }, [token, selectedConversationId, fetchMessages]);

  useEffect(() => {
    if (!token) return;
    const socket = io(SOCKET_URL, { transports: ['websocket'], withCredentials: true });
    socketRef.current = socket;

    const handleConnected = () =>
      fetchMessages({ silent: true, conversationId: selectedConversationId });

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
  }, [token, handleIncomingMessage, fetchMessages, selectedConversationId]);

  const sendMessage = async () => {
    if (!content.trim()) {
      setError('Vui lòng nhập nội dung tin nhắn');
      return;
    }

    const targetConversationId = normalizeConversationId(selectedConversationId);
    const apiConversationId =
      targetConversationId === GENERAL_CONVERSATION_ID ? undefined : targetConversationId;

    setSubmitting(true);
    setError(null);
    try {
      const payload = {
        token: getToken(),
        content: content.trim(),
        ...(apiConversationId ? { conversationId: apiConversationId } : {}),
      };
      const socket = socketRef.current;
      if (socket?.connected) {
        await new Promise<void>((resolve, reject) => {
          socket.timeout(5000).emit('message:send', payload, (response: unknown) => {
            const data = response as
              | { status: 'ok'; data: Message }
              | { status: 'error'; error?: string };
            if (data?.status === 'ok') return resolve();
            reject(new Error(data?.error ?? 'Không thể gửi tin nhắn'));
          });
        });
      } else {
        const response = await fetch(`${API_BASE_URL}/api/messages`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...authHeaders() },
          body: JSON.stringify(payload),
        });
        if (!response.ok) throw new Error('Không thể gửi tin nhắn');
        const message: Message = await response.json();
        handleIncomingMessage(message);
      }
      setContent('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Lỗi không xác định');
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
      <div className="flex-1 overflow-hidden">
        <ChatLayout
          conversations={conversations}
          selectedConversationId={selectedConversationId}
          onSelectConversation={handleSelectConversation}
          messages={chatMessages}
          loading={loading}
          error={error}
          onRetry={() => fetchMessages({ conversationId: selectedConversationId })}
          inputValue={content}
          onInputChange={setContent}
          onSend={sendMessage}
          sending={submitting}
          currentUserName={user?.username}
        />
      </div>
    </div>
  );
}

function App() {
  const [view, setView] = useState<'login' | 'register' | 'chat'>(() => {
    const t = getToken();
    return t ? 'chat' : 'login';
  });
  const goLogin = () => setView('login');
  const goRegister = () => setView('register');
  const goChat = () => setView('chat');

  return (
    <AuthProvider>
      {view === 'login' && <Login goRegister={goRegister} goChat={goChat} />}
      {view === 'register' && <Register goLogin={goLogin} goChat={goChat} />}
      {view === 'chat' && <Chat />}
    </AuthProvider>
  );
}

export default App;

