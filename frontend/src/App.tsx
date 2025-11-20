import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Camera, CameraOff, Mic, MicOff, PhoneIncoming, PhoneOff } from 'lucide-react';
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
  isRecalled?: boolean;
  recalledAt?: string | null;
  recalledBy?: string | null;
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
  isArchived?: boolean;
  archivedAt?: string | null;
};

type CallType = 'audio' | 'video';
type CallDirection = 'incoming' | 'outgoing';
type CallStatus = 'ringing' | 'connecting' | 'active';

type CallSession = {
  callId: string;
  conversationId: string;
  callType: CallType;
  otherUser: {
    id: string;
    username: string;
  };
  direction: CallDirection;
  status: CallStatus;
  conversationTitle?: string;
};

type IncomingCallPayload = {
  callId: string;
  conversationId: string;
  callType: CallType;
  caller: {
    id: string;
    username: string;
  };
  offer: RTCSessionDescriptionInit;
  conversationTitle?: string;
};

type CallAnswerPayload = {
  callId: string;
  answer: RTCSessionDescriptionInit;
};

type CallIceCandidatePayload = {
  callId: string;
  candidate: RTCIceCandidateInit;
};

const RTC_CONFIGURATION: RTCConfiguration = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
  ],
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
    isArchived: Boolean(conversation.isArchived),
    archivedAt: conversation.archivedAt ?? null,
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
  const [archivedConversations, setArchivedConversations] = useState<ConversationPreview[]>([]);
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
  const archivedConversationsRef = useRef<ConversationPreview[]>(archivedConversations);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const voiceStreamRef = useRef<MediaStream | null>(null);
  const voiceChunksRef = useRef<Blob[]>([]);
  const voiceMessageBlobRef = useRef<Blob | null>(null);
  const [voiceMessagePending, setVoiceMessagePending] = useState(false);
  const [voiceRecordingReady, setVoiceRecordingReady] = useState(false);
  const [callSession, setCallSession] = useState<CallSession | null>(null);
  const [showCallOverlay, setShowCallOverlay] = useState(false);
  const [callError, setCallError] = useState<string | null>(null);
  const [localMediaStream, setLocalMediaStream] = useState<MediaStream | null>(null);
  const [remoteMediaStream, setRemoteMediaStream] = useState<MediaStream | null>(null);
  const [callMuted, setCallMuted] = useState(false);
  const [cameraEnabled, setCameraEnabled] = useState(true);
  const [callDuration, setCallDuration] = useState(0);
  const peerConnectionRef = useRef<RTCPeerConnection | null>(null);
  const callSessionRef = useRef<CallSession | null>(null);
  const localCallStreamRef = useRef<MediaStream | null>(null);
  const remoteCallStreamRef = useRef<MediaStream | null>(null);
  const pendingRemoteCandidatesRef = useRef<RTCIceCandidateInit[]>([]);
  const incomingOfferRef = useRef<RTCSessionDescriptionInit | null>(null);
  const callTimerRef = useRef<number | null>(null);

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

  const mapToChatMessage = useCallback(
    (message: Message): ChatMessage => ({
      id: message._id,
      content: message.content,
      sender: message.sender,
      senderId: message.senderId ?? undefined,
      createdAt: message.createdAt,
      conversation: typeof message.conversation === 'string' ? message.conversation : undefined,
      messageType: message.messageType ?? 'text',
      voiceRecording: message.voiceRecording ?? undefined,
      image: message.image ?? undefined,
      file: message.file ?? undefined,
      seenBy: message.seenBy ?? [],
      isRecalled: message.isRecalled ?? false,
      recalledAt: message.recalledAt ?? undefined,
      recalledBy: message.recalledBy ?? undefined,
    }),
    [],
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

  const updateArchivedConversations = useCallback(
    (updater: (prev: ConversationPreview[]) => ConversationPreview[]) => {
      setArchivedConversations((prev) => {
        const next = updater(prev);
        archivedConversationsRef.current = next;
        return next;
      });
    },
    [],
  );

  const isConversationArchived = useCallback((conversationId?: string | null) => {
    if (!conversationId) {
      return false;
    }
    return archivedConversationsRef.current.some((conversation) => conversation.id === conversationId);
  }, []);

  const updateConversationFromMessages = useCallback(
    (conversationId: string | null | undefined, messageList: Message[]) => {
      if (!conversationId) {
        return;
      }
      const latest = messageList.length > 0 ? messageList[messageList.length - 1] : null;
      const conversationIsArchived = isConversationArchived(conversationId);

      const applyUpdate = (
        prev: ConversationPreview[],
        {
          allowCreate,
          forceArchivedFlag,
        }: {
          allowCreate: boolean;
          forceArchivedFlag: boolean;
        },
      ) => {
        const existing = prev.find((conversation) => conversation.id === conversationId);
        if (!existing && !allowCreate) {
          return prev;
        }

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
                isArchived: forceArchivedFlag,
              }
            : {
                id: conversationId,
                title: 'Cuộc trò chuyện',
                subtitle: 'Tin nhắn mới',
                avatarFallback: 'C',
                isGroup: false,
                unreadCount: 0,
                isArchived: forceArchivedFlag,
              });

        const list = existing ? prev : [...prev, base];
        let mutated = !existing;

        const next = list.map((conversation) => {
          if (conversation.id !== conversationId) {
            return conversation;
          }
          const updated = {
            ...conversation,
            title: conversation.title || base.title,
            subtitle: conversation.subtitle ?? base.subtitle,
            avatarFallback: conversation.avatarFallback ?? base.avatarFallback,
            lastMessageSnippet: latest ? buildSenderSnippet(latest) : conversation.lastMessageSnippet,
            updatedAt: latest?.createdAt ?? conversation.updatedAt,
            unreadCount: 0,
          };
          if (forceArchivedFlag) {
            updated.isArchived = true;
          } else if (typeof updated.isArchived === 'undefined') {
            updated.isArchived = false;
          }
          if (
            updated.title !== conversation.title ||
            updated.subtitle !== conversation.subtitle ||
            updated.avatarFallback !== conversation.avatarFallback ||
            updated.lastMessageSnippet !== conversation.lastMessageSnippet ||
            updated.updatedAt !== conversation.updatedAt ||
            updated.unreadCount !== conversation.unreadCount ||
            updated.isArchived !== conversation.isArchived
          ) {
            mutated = true;
          }
          return updated;
        });

        return mutated ? sortConversations(next) : list;
      };

      updateConversations((prev) =>
        applyUpdate(prev, { allowCreate: !conversationIsArchived, forceArchivedFlag: false }),
      );
      updateArchivedConversations((prev) =>
        applyUpdate(prev, { allowCreate: conversationIsArchived, forceArchivedFlag: true }),
      );
    },
    [isConversationArchived, updateArchivedConversations, updateConversations],
  );

  const updateConversationPreviewFromMessage = useCallback(
    (conversationId: string | null | undefined, message: Message, resetUnread: boolean) => {
      if (!conversationId) {
        return;
      }
      const conversationIsArchived = isConversationArchived(conversationId);

      const applyUpdate = (
        prev: ConversationPreview[],
        {
          allowCreate,
          forceArchivedFlag,
        }: {
          allowCreate: boolean;
          forceArchivedFlag: boolean;
        },
      ) => {
        const existing = prev.find((conversation) => conversation.id === conversationId);
        if (!existing && !allowCreate) {
          return prev;
        }

        const base =
          existing ??
          {
            id: conversationId,
            title: `Cuộc trò chuyện với ${message.sender ?? 'người dùng'}`,
            subtitle: `Tin nhắn từ ${message.sender ?? 'người dùng'}`,
            avatarFallback: getInitials(message.sender ?? 'Chat'),
            isGroup: false,
            unreadCount: 0,
            isArchived: forceArchivedFlag,
          };

        const list = existing ? prev : [...prev, base];
        let mutated = !existing;

        const next = list.map((conversation) => {
          if (conversation.id !== conversationId) {
            return conversation;
          }
          const unreadCount = resetUnread ? 0 : (conversation.unreadCount ?? 0) + 1;
          const updated = {
            ...conversation,
            title: conversation.title || base.title,
            subtitle: conversation.subtitle ?? base.subtitle,
            avatarFallback: conversation.avatarFallback ?? base.avatarFallback,
            lastMessageSnippet: buildSenderSnippet(message),
            updatedAt: message.createdAt,
            unreadCount,
          };
          if (forceArchivedFlag) {
            updated.isArchived = true;
          } else if (typeof updated.isArchived === 'undefined') {
            updated.isArchived = false;
          }
          if (
            updated.title !== conversation.title ||
            updated.subtitle !== conversation.subtitle ||
            updated.avatarFallback !== conversation.avatarFallback ||
            updated.lastMessageSnippet !== conversation.lastMessageSnippet ||
            updated.updatedAt !== conversation.updatedAt ||
            updated.unreadCount !== conversation.unreadCount ||
            updated.isArchived !== conversation.isArchived
          ) {
            mutated = true;
          }
          return updated;
        });

        return mutated ? sortConversations(next) : list;
      };

      updateConversations((prev) =>
        applyUpdate(prev, { allowCreate: !conversationIsArchived, forceArchivedFlag: false }),
      );
      updateArchivedConversations((prev) =>
        applyUpdate(prev, { allowCreate: conversationIsArchived, forceArchivedFlag: true }),
      );
    },
    [isConversationArchived, updateArchivedConversations, updateConversations],
  );

  const patchConversationPreview = useCallback(
    (
      conversationId: string | null | undefined,
      patch: (conversation: ConversationPreview) => ConversationPreview,
    ) => {
      if (!conversationId) {
        return;
      }
      const applyPatch = (prev: ConversationPreview[]) => {
        let changed = false;
        const next = prev.map((conversation) => {
          if (conversation.id !== conversationId) {
            return conversation;
          }
          changed = true;
          return patch(conversation);
        });
        return changed ? sortConversations(next) : prev;
      };
      updateConversations(applyPatch);
      updateArchivedConversations(applyPatch);
    },
    [updateArchivedConversations, updateConversations],
  );

  const applyMessageUpdate = useCallback(
    (message: Message) => {
      const normalized = normalizeMessagePayload(message);
      setMessages((prev) => {
        const exists = prev.some((item) => item._id === normalized._id);
        if (!exists) {
          return prev;
        }
        return prev.map((item) => (item._id === normalized._id ? normalized : item));
      });
      const conversationId =
        typeof normalized.conversation === 'string'
          ? normalized.conversation
          : null;
      if (conversationId) {
        patchConversationPreview(conversationId, (conversation) => ({
          ...conversation,
          lastMessageSnippet: buildSenderSnippet(normalized),
          updatedAt: normalized.createdAt,
        }));
      }
    },
    [normalizeMessagePayload, patchConversationPreview],
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

  const removeFriend = useCallback(
    async (friendId: string) => {
      if (!token) {
        throw new Error('Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.');
      }
      const endpoint = `${API_BASE_URL}/api/friends/${friendId}`;
      const response = await fetch(endpoint, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
      });
      const payload = (await response.json()) as { message?: string; error?: string };
      if (!response.ok) {
        throw new Error(payload?.error ?? 'Không thể xoá bạn bè');
      }
      setFriends((prev) => prev.filter((friend) => friend.id !== friendId));
      setUserSearchResults((prev) => prev.filter((user) => user.id !== friendId));
      setFriendFeedback({
        type: 'success',
        message: payload?.message ?? 'Đã xoá bạn khỏi danh sách',
      });
    },
    [token],
  );

  const removeConversationFromLists = useCallback(
    (conversationId: string) => {
      updateConversations((prev) => prev.filter((conversation) => conversation.id !== conversationId));
      updateArchivedConversations((prev) =>
        prev.filter((conversation) => conversation.id !== conversationId),
      );
      if (messagesConversationId === conversationId) {
        setMessages([]);
        setMessagesConversationId(null);
        setPendingMessages(new Map());
      }
      if (selectedConversationId === conversationId) {
        setSelectedConversationId(null);
        setContent('');
        setMessagesError(null);
      }
    },
    [
      messagesConversationId,
      selectedConversationId,
      updateArchivedConversations,
      updateConversations,
    ],
  );

  const deleteConversation = useCallback(
    async (conversationId: string) => {
      if (!token) {
        throw new Error('Vui lòng đăng nhập lại.');
      }
      const endpoint = `${API_BASE_URL}/api/conversations/${conversationId}`;
      const response = await fetch(endpoint, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error((payload as { error?: string })?.error ?? 'Không thể xoá cuộc trò chuyện');
      }
      removeConversationFromLists(conversationId);
    },
    [token, removeConversationFromLists],
  );

  const leaveConversation = useCallback(
    async (conversationId: string, options?: { mode?: 'silent' | 'block' }) => {
      if (!token) {
        throw new Error('Vui lòng đăng nhập lại.');
      }
      const endpoint = `${API_BASE_URL}/api/conversations/${conversationId}/leave`;
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ mode: options?.mode ?? 'silent' }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error((payload as { error?: string })?.error ?? 'Không thể rời nhóm');
      }
      removeConversationFromLists(conversationId);
    },
    [token, removeConversationFromLists],
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

  const fetchArchivedConversations = useCallback(async () => {
    if (!token) {
      updateArchivedConversations(() => []);
      return;
    }
    const endpoint = `${API_BASE_URL}/api/conversations?archived=true`;
    const response = await fetch(endpoint, {
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
    });
    const payload = (await response.json()) as unknown;
    if (!response.ok) {
      const errorMessage =
        typeof payload === 'object' && payload && 'error' in payload
          ? String((payload as { error?: string }).error)
          : 'Không thể tải cuộc trò chuyện đã lưu trữ';
      throw new Error(errorMessage);
    }
    const data = Array.isArray(payload) ? (payload as ConversationResponse[]) : [];
    const mapped = data.map((item) => mapConversationResponse(item, user?.id));
    updateArchivedConversations(() => sortConversations(mapped));
  }, [token, updateArchivedConversations, user?.id]);

  const refreshArchivedConversations = useCallback(async () => {
    await fetchArchivedConversations();
  }, [fetchArchivedConversations]);

  const archiveConversation = useCallback(
    async (conversationId: string) => {
      if (!token) {
        throw new Error('Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.');
      }
      const endpoint = `${API_BASE_URL}/api/conversations/${conversationId}/archive`;
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
      });
      const payload = (await response.json()) as (ConversationResponse & { error?: string });
      if (!response.ok) {
        throw new Error(payload?.error ?? 'Không thể lưu trữ cuộc trò chuyện');
      }
      const preview = { ...mapConversationResponse(payload, user?.id), isArchived: true };
      updateConversations((prev) => prev.filter((conversation) => conversation.id !== conversationId));
      updateArchivedConversations((prev) =>
        sortConversations([...prev.filter((conversation) => conversation.id !== conversationId), preview]),
      );
    },
    [token, updateConversations, updateArchivedConversations, user?.id],
  );

  const unarchiveConversation = useCallback(
    async (conversationId: string) => {
      if (!token) {
        throw new Error('Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.');
      }
      const endpoint = `${API_BASE_URL}/api/conversations/${conversationId}/archive`;
      const response = await fetch(endpoint, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
      });
      const payload = (await response.json()) as (ConversationResponse & { error?: string });
      if (!response.ok) {
        throw new Error(payload?.error ?? 'Không thể bỏ lưu trữ cuộc trò chuyện');
      }
      const preview = { ...mapConversationResponse(payload, user?.id), isArchived: false };
      updateArchivedConversations((prev) =>
        prev.filter((conversation) => conversation.id !== conversationId),
      );
      updateConversations((prev) =>
        sortConversations([...prev.filter((conversation) => conversation.id !== conversationId), preview]),
      );
    },
    [token, updateArchivedConversations, updateConversations, user?.id],
  );

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

  const handleMessageUpdated = useCallback(
    (message: Message) => {
      applyMessageUpdate(message);
    },
    [applyMessageUpdate],
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

  const recallMessage = useCallback(
    async (messageId: string) => {
      if (!token) {
        throw new Error('Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.');
      }
      const endpoint = `${API_BASE_URL}/api/messages/${messageId}/recall`;
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
      });
      const payload = (await response.json()) as (Message & { error?: string });
      if (!response.ok) {
        throw new Error(payload?.error ?? 'Không thể thu hồi tin nhắn');
      }
      applyMessageUpdate(payload);
    },
    [token, applyMessageUpdate],
  );

  const searchConversationMessages = useCallback(
    async (conversationId: string, query: string) => {
      if (!token) {
        throw new Error('Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.');
      }
      const endpoint = `${API_BASE_URL}/api/messages/search?conversationId=${encodeURIComponent(
        conversationId,
      )}&query=${encodeURIComponent(query)}`;
      const response = await fetch(endpoint, {
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
      });
      const payload = (await response.json()) as unknown;
      if (!response.ok) {
        const errorMessage =
          typeof payload === 'object' && payload && 'error' in payload
            ? String((payload as { error?: string }).error)
            : 'Không thể tìm kiếm tin nhắn';
        throw new Error(errorMessage);
      }
      const data = Array.isArray(payload) ? (payload as Message[]) : [];
      const normalized = data.map((message) => normalizeMessagePayload(message));
      return normalized.map((message) => mapToChatMessage(message));
    },
    [token, mapToChatMessage, normalizeMessagePayload],
  );

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

  const addMembersToConversation = useCallback(
    async (conversationId: string, memberIds: string[]) => {
      if (!token) {
        throw new Error('Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.');
      }
      if (!conversationId) {
        throw new Error('Không xác định được cuộc trò chuyện.');
      }
      if (!Array.isArray(memberIds) || memberIds.length === 0) {
        throw new Error('Vui lòng chọn ít nhất một thành viên.');
      }

      const endpoint = `${API_BASE_URL}/api/conversations/${conversationId}/members`;
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ memberIds }),
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload?.error ?? 'Không thể thêm thành viên mới');
      }
      const updatedPreview = mapConversationResponse(payload, user?.id);
      setConversations((prev) =>
        sortConversations([
          ...prev.filter((conversation) => conversation.id !== updatedPreview.id),
          updatedPreview,
        ]),
      );
      setArchivedConversations((prev) => {
        const others = prev.filter((conversation) => conversation.id !== updatedPreview.id);
        if (updatedPreview.isArchived) {
          return sortConversations([...others, updatedPreview]);
        }
        return others;
      });
    },
    [token, user?.id],
  );

  const activeConversation = useMemo<ConversationPreview | null>(() => {
    if (!selectedConversationId) {
      return null;
    }
    return (
      conversations.find((conversation) => conversation.id === selectedConversationId) ??
      archivedConversations.find((conversation) => conversation.id === selectedConversationId) ??
      null
    );
  }, [archivedConversations, conversations, selectedConversationId]);

  const callTargetParticipant = useMemo(() => {
    if (!activeConversation || !user?.id) {
      return null;
    }
    if (activeConversation.isGroup) {
      return null;
    }
    const participants = activeConversation.participants ?? [];
    if (participants.length < 2) {
      return null;
    }
    return participants.find((participant) => participant.id && participant.id !== user.id) ?? null;
  }, [activeConversation, user?.id]);

  const canStartCall = Boolean(callTargetParticipant && selectedConversationId);
  const callButtonsDisabled = Boolean(callSession);

  const chatMessages = useMemo<ChatMessage[]>(() => {
    const result: ChatMessage[] = messages.map((message) => mapToChatMessage(message));

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
  }, [messages, pendingMessages, user?.username, user?.id, mapToChatMessage]);

  useEffect(() => {
    callSessionRef.current = callSession;
  }, [callSession]);

  const emitCallEvent = useCallback(
    async (eventName: string, payload: Record<string, unknown>) => {
      const socket = socketRef.current;
      if (!socket?.connected) {
        throw new Error('Không thể kết nối tới máy chủ tín hiệu');
      }
      await new Promise<void>((resolve, reject) => {
        socket
          .timeout(10000)
          .emit(
            eventName,
            { token: getToken(), ...payload },
            (err: unknown, response: { status: 'ok' | 'error'; error?: string } | undefined) => {
              if (err) {
                reject(err instanceof Error ? err : new Error('Tín hiệu quá hạn'));
                return;
              }
              if (response && response.status === 'error') {
                reject(new Error(response.error || 'Không thể xử lý tín hiệu'));
                return;
              }
              resolve();
            },
          );
      });
    },
    [],
  );

  const cleanupCallState = useCallback(() => {
    if (callTimerRef.current) {
      window.clearInterval(callTimerRef.current);
      callTimerRef.current = null;
    }
    pendingRemoteCandidatesRef.current = [];
    incomingOfferRef.current = null;
    callSessionRef.current = null;
    if (peerConnectionRef.current) {
      peerConnectionRef.current.onicecandidate = null;
      peerConnectionRef.current.ontrack = null;
      peerConnectionRef.current.onconnectionstatechange = null;
      peerConnectionRef.current.close();
      peerConnectionRef.current = null;
    }
    if (localCallStreamRef.current) {
      localCallStreamRef.current.getTracks().forEach((track) => track.stop());
      localCallStreamRef.current = null;
    }
    if (remoteCallStreamRef.current) {
      remoteCallStreamRef.current.getTracks().forEach((track) => track.stop());
      remoteCallStreamRef.current = null;
    }
    setLocalMediaStream(null);
    setRemoteMediaStream(null);
    setCallSession(null);
    setCallError(null);
    setCallDuration(0);
    setCallMuted(false);
    setCameraEnabled(true);
    setShowCallOverlay(false);
  }, []);

  const requestMediaStream = useCallback(async (type: CallType) => {
    if (typeof window === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      throw new Error('Trình duyệt của bạn không hỗ trợ cuộc gọi');
    }
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: true,
      video: type === 'video' ? { width: { ideal: 1280 }, height: { ideal: 720 } } : false,
    });
    localCallStreamRef.current = stream;
    setLocalMediaStream(stream);
    stream.getAudioTracks().forEach((track) => {
      track.enabled = true;
    });
    if (type === 'video') {
      stream.getVideoTracks().forEach((track) => {
        track.enabled = true;
      });
      setCameraEnabled(true);
    } else {
      setCameraEnabled(false);
    }
    setCallMuted(false);
    return stream;
  }, []);

  const createPeerConnection = useCallback(
    (callId: string) => {
      if (peerConnectionRef.current) {
        peerConnectionRef.current.onicecandidate = null;
        peerConnectionRef.current.ontrack = null;
        peerConnectionRef.current.onconnectionstatechange = null;
        peerConnectionRef.current.close();
      }
      const pc = new RTCPeerConnection(RTC_CONFIGURATION);
      peerConnectionRef.current = pc;

      pc.onicecandidate = (event) => {
        if (event.candidate) {
          const candidatePayload = event.candidate.toJSON();
          void emitCallEvent('call:ice-candidate', {
            callId,
            candidate: candidatePayload,
          }).catch((error) => {
            console.error('Failed to send ICE candidate:', error);
          });
        }
      };

      pc.ontrack = (event) => {
        const [stream] = event.streams;
        if (stream) {
          remoteCallStreamRef.current = stream;
          setRemoteMediaStream(stream);
        }
      };

      pc.onconnectionstatechange = () => {
        const state = pc.connectionState;
        if (state === 'connected') {
          setCallSession((prev) => (prev ? { ...prev, status: 'active' } : prev));
          if (!callTimerRef.current) {
            callTimerRef.current = window.setInterval(() => {
              setCallDuration((value) => value + 1);
            }, 1000);
          }
        }
        if (state === 'failed') {
          setCallError('Kết nối bị gián đoạn');
        }
        if (state === 'disconnected') {
          setCallError('Kết nối đã bị ngắt');
        }
      };

      return pc;
    },
    [emitCallEvent],
  );

  const initiateCall = useCallback(
    async (type: CallType) => {
      if (!selectedConversationId) {
        window.alert('Vui lòng chọn một cuộc trò chuyện trước khi gọi.');
        return;
      }
      if (!token) {
        window.alert('Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.');
        return;
      }
      if (!callTargetParticipant?.id) {
        window.alert('Không thể xác định người nhận cuộc gọi.');
        return;
      }
      if (callSessionRef.current) {
        window.alert('Bạn đang trong một cuộc gọi khác.');
        return;
      }
      try {
        const callId =
          typeof window !== 'undefined' &&
          window.crypto &&
          typeof window.crypto.randomUUID === 'function'
            ? window.crypto.randomUUID()
            : `call-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
        const session: CallSession = {
          callId,
          conversationId: selectedConversationId,
          callType: type,
          otherUser: {
            id: callTargetParticipant.id,
            username: callTargetParticipant.username,
          },
          direction: 'outgoing',
          status: 'ringing',
          conversationTitle: activeConversation?.title,
        };
        setCallSession(session);
        callSessionRef.current = session;
        setShowCallOverlay(true);
        setCallError(null);
        setCallDuration(0);
        pendingRemoteCandidatesRef.current = [];
        const stream = await requestMediaStream(type);
        const pc = createPeerConnection(callId);
        stream.getTracks().forEach((track) => pc.addTrack(track, stream));
        const offer = await pc.createOffer({
          offerToReceiveAudio: true,
          offerToReceiveVideo: type === 'video',
        });
        await pc.setLocalDescription(offer);
        await emitCallEvent('call:initiate', {
          callId,
          conversationId: selectedConversationId,
          callType: type,
          offer,
          targetUserId: callTargetParticipant.id,
        });
      } catch (error) {
        console.error('initiateCall error:', error);
        const message = error instanceof Error ? error.message : 'Không thể bắt đầu cuộc gọi';
        window.alert(message);
        cleanupCallState();
      }
    },
    [
      activeConversation?.title,
      callTargetParticipant,
      createPeerConnection,
      emitCallEvent,
      requestMediaStream,
      selectedConversationId,
      token,
      cleanupCallState,
    ],
  );

  const startVoiceCall = useCallback(() => {
    void initiateCall('audio');
  }, [initiateCall]);

  const startVideoCall = useCallback(() => {
    void initiateCall('video');
  }, [initiateCall]);

  const answerIncomingCall = useCallback(async () => {
    const session = callSessionRef.current;
    const offer = incomingOfferRef.current;
    if (!session || session.direction !== 'incoming' || !offer) {
      return;
    }
    try {
      const stream = await requestMediaStream(session.callType);
      const pc = createPeerConnection(session.callId);
      stream.getTracks().forEach((track) => pc.addTrack(track, stream));
      await pc.setRemoteDescription(offer);
      const queued = [...pendingRemoteCandidatesRef.current];
      pendingRemoteCandidatesRef.current = [];
      for (const candidate of queued) {
        try {
          await pc.addIceCandidate(new RTCIceCandidate(candidate));
        } catch (candidateError) {
          console.error('Failed to add queued ICE candidate:', candidateError);
        }
      }
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      setCallSession((prev) => (prev ? { ...prev, status: 'connecting' } : prev));
      incomingOfferRef.current = null;
      await emitCallEvent('call:answer', {
        callId: session.callId,
        answer,
      });
    } catch (error) {
      console.error('answerIncomingCall error:', error);
      const message = error instanceof Error ? error.message : 'Không thể trả lời cuộc gọi';
      window.alert(message);
      cleanupCallState();
    }
  }, [createPeerConnection, emitCallEvent, requestMediaStream, cleanupCallState]);

  const declineIncomingCall = useCallback(async () => {
    const session = callSessionRef.current;
    if (!session) {
      return;
    }
    try {
      await emitCallEvent('call:decline', { callId: session.callId });
    } catch (error) {
      console.error('declineIncomingCall error:', error);
    } finally {
      cleanupCallState();
    }
  }, [emitCallEvent, cleanupCallState]);

  const hangupCall = useCallback(async () => {
    const session = callSessionRef.current;
    if (!session) {
      return;
    }
    try {
      if (session.direction === 'outgoing' && session.status === 'ringing') {
        await emitCallEvent('call:cancel', { callId: session.callId });
      } else {
        await emitCallEvent('call:end', { callId: session.callId, reason: 'ended' });
      }
    } catch (error) {
      console.error('hangupCall error:', error);
    } finally {
      cleanupCallState();
    }
  }, [emitCallEvent, cleanupCallState]);

  const toggleMute = useCallback(() => {
    const stream = localCallStreamRef.current;
    if (!stream) {
      return;
    }
    const nextMuted = !callMuted;
    stream.getAudioTracks().forEach((track) => {
      track.enabled = !nextMuted;
    });
    setCallMuted(nextMuted);
  }, [callMuted]);

  const toggleCamera = useCallback(() => {
    const stream = localCallStreamRef.current;
    if (!stream) {
      return;
    }
    const nextEnabled = !cameraEnabled;
    stream.getVideoTracks().forEach((track) => {
      track.enabled = nextEnabled;
    });
    setCameraEnabled(nextEnabled);
  }, [cameraEnabled]);

  const handleCallIncoming = useCallback(
    (payload: IncomingCallPayload) => {
      if (!payload?.callId || !payload.offer) {
        return;
      }
      if (callSessionRef.current) {
        void emitCallEvent('call:decline', { callId: payload.callId }).catch(() => {});
        return;
      }
      pendingRemoteCandidatesRef.current = [];
      incomingOfferRef.current = payload.offer;
      const session: CallSession = {
        callId: payload.callId,
        conversationId: payload.conversationId,
        callType: payload.callType,
        otherUser: {
          id: payload.caller?.id ?? '',
          username: payload.caller?.username ?? 'Người dùng',
        },
        direction: 'incoming',
        status: 'ringing',
        conversationTitle: payload.conversationTitle,
      };
      callSessionRef.current = session;
      setCallSession(session);
      setShowCallOverlay(true);
      setCallDuration(0);
      setCallError(null);
    },
    [emitCallEvent],
  );

  const handleCallAnswer = useCallback(
    async (payload: CallAnswerPayload) => {
      const session = callSessionRef.current;
      if (!session || session.callId !== payload?.callId) {
        return;
      }
      const pc = peerConnectionRef.current;
      if (!pc || !payload.answer) {
        return;
      }
      try {
        await pc.setRemoteDescription(payload.answer);
        const queued = [...pendingRemoteCandidatesRef.current];
        pendingRemoteCandidatesRef.current = [];
        for (const candidate of queued) {
          try {
            await pc.addIceCandidate(new RTCIceCandidate(candidate));
          } catch (candidateError) {
            console.error('Failed to add queued ICE candidate:', candidateError);
          }
        }
        setCallSession((prev) => (prev ? { ...prev, status: 'connecting' } : prev));
      } catch (error) {
        console.error('handleCallAnswer error:', error);
        window.alert('Không thể thiết lập cuộc gọi.');
        cleanupCallState();
      }
    },
    [cleanupCallState],
  );

  const handleCallIceCandidate = useCallback(async (payload: CallIceCandidatePayload) => {
    const session = callSessionRef.current;
    if (!session || session.callId !== payload?.callId || !payload?.candidate) {
      return;
    }
    const pc = peerConnectionRef.current;
    if (!pc || !pc.remoteDescription) {
      pendingRemoteCandidatesRef.current.push(payload.candidate);
      return;
    }
    try {
      await pc.addIceCandidate(new RTCIceCandidate(payload.candidate));
    } catch (error) {
      console.error('Failed to add ICE candidate:', error);
    }
  }, []);

  const handleCallDeclined = useCallback(
    (payload: { callId?: string }) => {
      const session = callSessionRef.current;
      if (!session || session.callId !== payload?.callId) {
        return;
      }
      cleanupCallState();
      window.alert('Người nhận đã từ chối cuộc gọi.');
    },
    [cleanupCallState],
  );

  const handleCallCancelled = useCallback(
    (payload: { callId?: string }) => {
      const session = callSessionRef.current;
      if (!session || session.callId !== payload?.callId) {
        return;
      }
      cleanupCallState();
      window.alert('Người gọi đã huỷ cuộc gọi.');
    },
    [cleanupCallState],
  );

  const handleCallEnded = useCallback(
    (payload: { callId?: string; reason?: string; endedBy?: string }) => {
      const session = callSessionRef.current;
      if (!session || session.callId !== payload?.callId) {
        return;
      }
      const endedBySelf = payload?.endedBy && payload.endedBy === user?.id;
      cleanupCallState();
      if (endedBySelf) {
        return;
      }
      if (payload?.reason === 'disconnect') {
        window.alert('Cuộc gọi đã kết thúc do mất kết nối.');
      } else {
        window.alert('Cuộc gọi đã kết thúc.');
      }
    },
    [cleanupCallState, user?.id],
  );

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

  useEffect(
    () => () => {
      cleanupCallState();
    },
    [cleanupCallState],
  );

  // Removed duplicate auto-select logic - handled in fetchConversations

  useEffect(() => {
    if (!token) return;
    fetchConversations();
    void fetchArchivedConversations().catch((err) =>
      console.error('fetchArchivedConversations error:', err),
    );
  }, [token, fetchConversations, fetchArchivedConversations]);

  useEffect(() => {
    if (!token) {
      cleanupCallState();
    }
  }, [token, cleanupCallState]);

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
      updateArchivedConversations(() => []);
      return;
    }
    fetchFriends();
    fetchFriendRequests();
  }, [token, fetchFriends, fetchFriendRequests, updateArchivedConversations]);

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
    socket.on('message:updated', handleMessageUpdated);
    socket.on('user:online', handleUserOnline);
    socket.on('user:offline', handleUserOffline);
    socket.on('message:seen', handleMessageSeen);
    socket.on('call:incoming', handleCallIncoming);
    socket.on('call:answer', handleCallAnswer);
    socket.on('call:ice-candidate', handleCallIceCandidate);
    socket.on('call:declined', handleCallDeclined);
    socket.on('call:cancelled', handleCallCancelled);
    socket.on('call:ended', handleCallEnded);

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
    socket.off('message:updated');
    socket.off('user:online');
    socket.off('user:offline');
    socket.off('message:seen');
    socket.off('call:incoming');
    socket.off('call:answer');
    socket.off('call:ice-candidate');
    socket.off('call:declined');
    socket.off('call:cancelled');
    socket.off('call:ended');

    socket.on('message:new', handleIncomingMessage);
    socket.on('message:updated', handleMessageUpdated);
    socket.on('user:online', handleUserOnline);
    socket.on('user:offline', handleUserOffline);
    socket.on('message:seen', handleMessageSeen);
    socket.on('call:incoming', handleCallIncoming);
    socket.on('call:answer', handleCallAnswer);
    socket.on('call:ice-candidate', handleCallIceCandidate);
    socket.on('call:declined', handleCallDeclined);
    socket.on('call:cancelled', handleCallCancelled);
    socket.on('call:ended', handleCallEnded);
  }, [
    token,
    handleIncomingMessage,
    handleMessageUpdated,
    handleUserOnline,
    handleUserOffline,
    handleMessageSeen,
    handleCallIncoming,
    handleCallAnswer,
    handleCallIceCandidate,
    handleCallDeclined,
    handleCallCancelled,
    handleCallEnded,
  ]);


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
      <div className="flex items-center justify-between border-b theme-border bg-[var(--surface-bg)] px-6 py-4 shadow-sm transition-colors">
        <h1 className="text-lg font-semibold text-[var(--text-primary)]">Chat App</h1>
        <button
          className="rounded-full bg-blue-500 px-4 py-2 text-sm font-medium text-white transition hover:bg-blue-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40"
          onClick={logout}
          type="button"
        >
          Đăng xuất
        </button>
      </div>
      <div className="flex-1 min-h-0 overflow-hidden">
        <ChatLayout
          conversations={conversations}
          archivedConversations={archivedConversations}
          selectedConversationId={selectedConversationId}
          onSelectConversation={handleSelectConversation}
          onArchiveConversation={archiveConversation}
          onUnarchiveConversation={unarchiveConversation}
          onRefreshArchived={refreshArchivedConversations}
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
          onRemoveFriend={removeFriend}
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
          onRecallMessage={recallMessage}
          onSearchMessages={searchConversationMessages}
          onDeleteConversation={deleteConversation}
          onLeaveConversation={leaveConversation}
          onAddConversationMembers={addMembersToConversation}
          onStartVoiceCall={startVoiceCall}
          onStartVideoCall={startVideoCall}
          canStartCall={canStartCall}
          callButtonsDisabled={callButtonsDisabled}
        />
      </div>
      {callSession && showCallOverlay && (
        <CallOverlay
          session={callSession}
          localStream={localMediaStream}
          remoteStream={remoteMediaStream}
          muted={callMuted}
          cameraEnabled={cameraEnabled}
          callError={callError}
          durationSeconds={callDuration}
          onHangup={hangupCall}
          onAnswer={
            callSession.direction === 'incoming' && callSession.status === 'ringing'
              ? answerIncomingCall
              : undefined
          }
          onDecline={
            callSession.direction === 'incoming' && callSession.status === 'ringing'
              ? declineIncomingCall
              : undefined
          }
          onToggleMute={toggleMute}
          onToggleCamera={
            callSession.callType === 'video' && callSession.status !== 'ringing'
              ? toggleCamera
              : undefined
          }
        />
      )}
    </div>
  );
}

type CallOverlayProps = {
  session: CallSession;
  localStream: MediaStream | null;
  remoteStream: MediaStream | null;
  muted: boolean;
  cameraEnabled: boolean;
  callError?: string | null;
  durationSeconds: number;
  onHangup: () => void;
  onAnswer?: () => void;
  onDecline?: () => void;
  onToggleMute: () => void;
  onToggleCamera?: () => void;
};

function CallOverlay({
  session,
  localStream,
  remoteStream,
  muted,
  cameraEnabled,
  callError,
  durationSeconds,
  onHangup,
  onAnswer,
  onDecline,
  onToggleMute,
  onToggleCamera,
}: CallOverlayProps) {
  const remoteVideoRef = useRef<HTMLVideoElement | null>(null);
  const localVideoRef = useRef<HTMLVideoElement | null>(null);
  const remoteAudioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    if (remoteVideoRef.current) {
      remoteVideoRef.current.srcObject = remoteStream ?? null;
    }
  }, [remoteStream]);

  useEffect(() => {
    if (localVideoRef.current) {
      localVideoRef.current.srcObject = localStream ?? null;
    }
  }, [localStream]);

  useEffect(() => {
    if (remoteAudioRef.current) {
      remoteAudioRef.current.srcObject =
        session.callType === 'audio' ? remoteStream ?? null : null;
    }
  }, [remoteStream, session.callType]);

  const formatDuration = (totalSeconds: number) => {
    if (totalSeconds <= 0) return '';
    const minutes = Math.floor(totalSeconds / 60)
      .toString()
      .padStart(2, '0');
    const seconds = (totalSeconds % 60).toString().padStart(2, '0');
    return `${minutes}:${seconds}`;
  };

  const statusText = callError
    ? callError
    : session.status === 'active'
      ? `Đang trò chuyện${durationSeconds > 0 ? ` • ${formatDuration(durationSeconds)}` : ''}`
      : session.status === 'connecting'
        ? 'Đang kết nối...'
        : session.direction === 'incoming'
          ? 'Cuộc gọi đến...'
          : 'Đang gọi...';

  const renderVideoPreview = () => (
    <div className="relative min-h-[260px] overflow-hidden rounded-2xl bg-slate-900 text-white dark:bg-slate-800/80">
      <video
        ref={remoteVideoRef}
        autoPlay
        playsInline
        className="h-full w-full object-cover"
      />
      {localStream && (
        <video
          ref={localVideoRef}
          autoPlay
          muted
          playsInline
          className="absolute bottom-4 right-4 h-32 w-24 rounded-xl border-2 border-white/70 object-cover shadow-lg"
        />
      )}
    </div>
  );

  const renderVoicePreview = () => (
    <div className="flex min-h-[220px] flex-col items-center justify-center gap-4 rounded-2xl bg-gradient-to-br from-blue-600 via-indigo-600 to-purple-600 text-white dark:from-blue-900 dark:via-indigo-900 dark:to-purple-900">
      <div className="flex size-24 items-center justify-center rounded-full bg-white/10 text-3xl font-semibold backdrop-blur">
        {getInitials(session.otherUser.username || 'U')}
      </div>
      <p className="text-lg font-semibold">{session.otherUser.username}</p>
    </div>
  );

  const renderActionButtons = () => {
    if (session.direction === 'incoming' && session.status === 'ringing') {
      return (
        <>
          <button
            type="button"
            onClick={onDecline}
            className="flex items-center gap-2 rounded-full bg-red-600 px-6 py-3 font-semibold text-white transition hover:bg-red-700"
          >
            <PhoneOff className="size-4" />
            Từ chối
          </button>
          <button
            type="button"
            onClick={onAnswer}
            className="flex items-center gap-2 rounded-full bg-green-500 px-6 py-3 font-semibold text-white transition hover:bg-green-600"
          >
            <PhoneIncoming className="size-4" />
            Nghe máy
          </button>
        </>
      );
    }

    if (session.direction === 'outgoing' && session.status === 'ringing') {
      return (
        <button
          type="button"
          onClick={onHangup}
          className="flex items-center gap-2 rounded-full bg-red-600 px-6 py-3 font-semibold text-white transition hover:bg-red-700"
        >
          <PhoneOff className="size-4" />
          Huỷ cuộc gọi
        </button>
      );
    }

    return (
      <>
        <button
          type="button"
          onClick={onToggleMute}
          className={`flex items-center gap-2 rounded-full px-6 py-3 font-semibold text-white transition ${
            muted ? 'bg-slate-400 hover:bg-slate-500' : 'bg-blue-600 hover:bg-blue-700'
          }`}
        >
          {muted ? <MicOff className="size-4" /> : <Mic className="size-4" />}
          {muted ? 'Bật mic' : 'Tắt mic'}
        </button>
        {session.callType === 'video' && onToggleCamera ? (
          <button
            type="button"
            onClick={onToggleCamera}
            className={`flex items-center gap-2 rounded-full px-6 py-3 font-semibold text-white transition ${
              cameraEnabled ? 'bg-slate-600 hover:bg-slate-700' : 'bg-slate-400 hover:bg-slate-500'
            }`}
          >
            {cameraEnabled ? <Camera className="size-4" /> : <CameraOff className="size-4" />}
            {cameraEnabled ? 'Tắt camera' : 'Bật camera'}
          </button>
        ) : null}
        <button
          type="button"
          onClick={onHangup}
          className="flex items-center gap-2 rounded-full bg-red-600 px-6 py-3 font-semibold text-white transition hover:bg-red-700"
        >
          <PhoneOff className="size-4" />
          Kết thúc
        </button>
      </>
    );
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[var(--overlay-backdrop)] px-4 py-6">
      <div className="glass-panel w-full max-w-3xl rounded-[32px] p-6 text-[var(--text-primary)] animate-scale-pop">
        <div className="space-y-6">
          <div className="text-center">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-theme">
              {session.callType === 'video' ? 'Video call' : 'Voice call'}
            </p>
            <h3 className="mt-1 text-2xl font-semibold text-[var(--text-primary)]">
              {session.otherUser.username}
            </h3>
            <p className="text-sm text-muted-theme">{statusText}</p>
            {session.conversationTitle && (
              <p className="text-xs text-subtle-theme">{session.conversationTitle}</p>
            )}
          </div>

          {session.callType === 'video' ? renderVideoPreview() : renderVoicePreview()}
          {session.callType === 'audio' ? (
            <audio ref={remoteAudioRef} autoPlay className="hidden" />
          ) : null}

          {callError ? <p className="text-center text-sm text-red-600">{callError}</p> : null}

          <div className="flex flex-wrap items-center justify-center gap-3">
            {renderActionButtons()}
          </div>
        </div>
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


