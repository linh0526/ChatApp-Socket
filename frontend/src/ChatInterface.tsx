import { useEffect, useMemo, useRef, useState } from 'react';
import type { ChangeEvent, FormEvent, KeyboardEvent, ReactNode } from 'react';
import {
  Archive,
  ArchiveRestore,
  Download,
  FileText,
  Image as ImageIcon,
  Info,
  Link as LinkIcon,
  Phone,
  Loader2,
  Video,
  Menu,
  Mic,
  Paperclip,
  Search,
  Send,
  Shield,
  Smile,
  Square,
  Trash2,
  UserPlus,
  X,
} from 'lucide-react';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Avatar, AvatarFallback, AvatarImage } from './ui/avatar';
import { ScrollArea } from './ui/scroll-area';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from './ui/sheet';
import type { ConversationPreview } from './ChatLayout';
import type { ChatMessage } from './chatTypes';
import type { FriendSummary } from './friendTypes';
import { Popover, PopoverContent, PopoverTrigger } from './ui/popover';

const extractUrls = (text?: string | null) => {
  if (typeof text !== 'string' || !text.trim()) {
    return [];
  }
  const matches = text.match(/https?:\/\/[^\s]+/gi);
  return matches ?? [];
};

const renderTextWithLinks = (text?: string | null) => {
  if (!text) {
    return null;
  }
  const nodes: Array<string | ReactNode> = [];
  const regex = /https?:\/\/[^\s]+/gi;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(text)) !== null) {
    const start = match.index;
    const url = match[0];
    if (start > lastIndex) {
      nodes.push(text.slice(lastIndex, start));
    }
    nodes.push(
      <a
        key={`url-${start}`}
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        className="text-blue-600 underline break-words"
      >
        {url}
      </a>,
    );
    lastIndex = start + url.length;
  }
  if (lastIndex < text.length) {
    nodes.push(text.slice(lastIndex));
  }
  return nodes.map((segment, index) =>
    typeof segment === 'string' ? (
      <span key={`segment-${index}`}>{segment}</span>
    ) : (
      segment
    ),
  );
};

const LinkPreviewCard = ({ url }: { url: string }) => {
  let hostname = url;
  try {
    const parsed = new URL(url);
    hostname = parsed.hostname;
  } catch {
    // ignore invalid URL
  }
  return (
    <div className="mt-2 rounded-xl border theme-border bg-[var(--surface-bg)] p-3 text-left text-sm shadow-sm">
      <p className="text-sm font-semibold text-[var(--text-primary)]">{hostname}</p>
      <p className="truncate text-xs text-muted-theme">{url}</p>
      <Button
        asChild
        variant="outline"
        size="sm"
        className="mt-2 w-fit rounded-full text-xs"
      >
        <a href={url} target="_blank" rel="noopener noreferrer">
          Mở liên kết
        </a>
      </Button>
    </div>
  );
};

interface ChatInterfaceProps {
  conversation?: ConversationPreview;
  selectedConversationId?: string | null;
  messages: ChatMessage[];
  messagesError?: string | null;
  currentUserName?: string | null;
  currentUserId?: string | null;
  inputValue: string;
  onInputChange: (value: string) => void;
  onSend: () => void;
  sending: boolean;
  loading: boolean;
  onRetry?: () => void;
  onVoiceMessage?: () => void | Promise<void>;
  voiceMessagePending?: boolean;
  onVoiceMessageStop?: () => boolean | Promise<boolean>;
  onVoiceMessageSend?: () => void | Promise<void>;
  onVoiceMessageCancel?: () => void | Promise<void>;
  voiceRecordingReady?: boolean;
  isMobile?: boolean;
  onOpenSidebar?: () => void;
  onSendImage?: (file: File) => void | Promise<void>;
  onSendFile?: (file: File) => void | Promise<void>;
  friends: FriendSummary[];
  onRecallMessage?: (messageId: string) => Promise<void>;
  onSearchMessages?: (conversationId: string, query: string) => Promise<ChatMessage[]>;
  onArchiveConversation?: (conversationId: string) => Promise<void>;
  onUnarchiveConversation?: (conversationId: string) => Promise<void>;
  onDeleteConversation?: (conversationId: string) => Promise<void>;
  onLeaveConversation?: (
    conversationId: string,
    options?: { mode?: 'silent' | 'block' },
  ) => Promise<void>;
  onAddConversationMembers?: (conversationId: string, memberIds: string[]) => Promise<void>;
  onStartVoiceCall?: () => void;
  onStartVideoCall?: () => void;
  canStartCall?: boolean;
  callButtonsDisabled?: boolean;
}

const getInitials = (text: string) =>
  text
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0])
    .join('')
    .toUpperCase();

export function ChatInterface({
  conversation,
  selectedConversationId,
  messages,
  messagesError,
  currentUserName,
  currentUserId,
  inputValue,
  onInputChange,
  onSend,
  sending,
  loading,
  onRetry,
  onVoiceMessage,
  voiceMessagePending,
  onVoiceMessageStop,
  onVoiceMessageSend,
  onVoiceMessageCancel,
  voiceRecordingReady,
  isMobile,
  onOpenSidebar,
  onSendImage,
  onSendFile,
  friends = [],
  onRecallMessage,
  onSearchMessages,
  onArchiveConversation,
  onUnarchiveConversation,
  onDeleteConversation,
  onLeaveConversation,
  onAddConversationMembers,
  onStartVoiceCall,
  onStartVideoCall,
  canStartCall = false,
  callButtonsDisabled = false,
}: ChatInterfaceProps) {
  const scrollAreaRef = useRef<HTMLDivElement>(null);
  const lastRequestedConversationRef = useRef<string | null>(null);
  const [voiceComposerState, setVoiceComposerState] = useState<'idle' | 'recording' | 'review'>('idle');
  const [emojiPickerOpen, setEmojiPickerOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const fileUploadInputRef = useRef<HTMLInputElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const [searchPopoverOpen, setSearchPopoverOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<ChatMessage[]>([]);
  const [searchingMessages, setSearchingMessages] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [hasSearchedMessages, setHasSearchedMessages] = useState(false);
  const [recallingMessageId, setRecallingMessageId] = useState<string | null>(null);
  const [highlightMessageId, setHighlightMessageId] = useState<string | null>(null);
  const [archivePending, setArchivePending] = useState(false);
  const [infoPanelOpen, setInfoPanelOpen] = useState(false);
  const [nicknameInput, setNicknameInput] = useState('');
  const [nicknameDisplay, setNicknameDisplay] = useState('');
  const [blockedUser, setBlockedUser] = useState(false);
  const [isBlocking, setIsBlocking] = useState(false);
  const [deleteConversationPending, setDeleteConversationPending] = useState(false);
  const [leaveGroupPending, setLeaveGroupPending] = useState<'silent' | 'block' | null>(null);
  const [addMembersOpen, setAddMembersOpen] = useState(false);
  const [addMembersLoading, setAddMembersLoading] = useState(false);
  const [addMembersError, setAddMembersError] = useState<string | null>(null);
  const [selectedMemberIds, setSelectedMemberIds] = useState<string[]>([]);

  const conversationDisplay = useMemo<ConversationPreview | null>(() => {
    if (conversation) return conversation;
    if (!selectedConversationId) return null;

    return {
      id: selectedConversationId,
      title: 'Cuộc trò chuyện',
      subtitle: 'Đang tải thông tin...',
      avatarFallback: getInitials('Chat'),
      isGroup: false,
      participants: [],
    };
  }, [conversation, selectedConversationId]);

  const otherParticipant = useMemo(() => {
    if (!conversationDisplay?.participants || conversationDisplay.participants.length === 0) {
      return null;
    }
    if (!currentUserId) {
      return conversationDisplay.participants[0] ?? null;
    }
    return (
      conversationDisplay.participants.find((participant) => participant.id && participant.id !== currentUserId) ??
      null
    );
  }, [conversationDisplay?.participants, currentUserId]);

  const otherFriend = useMemo(
    () => friends.find((friend) => friend.id === otherParticipant?.id),
    [friends, otherParticipant?.id],
  );

  const statusLabel = useMemo(() => {
    if (!conversationDisplay) {
      return '';
    }
    if (conversationDisplay.isGroup) {
      return (
        conversationDisplay.subtitle ??
        `${conversationDisplay.participants?.length ?? 0} thành viên`
      );
    }
    if (otherFriend?.isOnline === true) {
      return 'Đang trực tuyến';
    }
    if (otherFriend?.isOnline === false) {
      return 'Ngoại tuyến';
    }
    return conversationDisplay.subtitle ?? 'Trò chuyện trực tiếp';
  }, [conversationDisplay, otherFriend]);

  const statusClass = useMemo(() => {
    if (conversationDisplay?.isGroup) {
      return 'text-muted-theme';
    }
    if (otherFriend?.isOnline) {
      return 'text-green-600';
    }
    return 'text-muted-theme';
  }, [conversationDisplay?.isGroup, otherFriend]);

  const otherParticipantIds = useMemo(() => {
    const ids =
      conversationDisplay?.participants
        ?.map((participant) => participant.id)
        .filter((id): id is string => Boolean(id)) ?? [];
    if (!currentUserId) {
      return ids;
    }
    return ids.filter((id) => id !== currentUserId);
  }, [conversationDisplay?.participants, currentUserId]);

  const participantLookup = useMemo(() => {
    const map = new Map<string, NonNullable<ConversationPreview['participants']>[number]>();
    for (const participant of conversationDisplay?.participants ?? []) {
      if (!participant?.username) continue;
      map.set(participant.username.toLowerCase(), participant);
      if (participant.email) {
        map.set(participant.email.toLowerCase(), participant);
      }
    }
    return map;
  }, [conversationDisplay?.participants]);

  const participantIdsSet = useMemo(() => {
    const ids = new Set<string>();
    for (const participant of conversationDisplay?.participants ?? []) {
      if (participant?.id) {
        ids.add(participant.id);
      }
    }
    return ids;
  }, [conversationDisplay?.participants]);

  const availableFriends = useMemo(
    () =>
      friends.filter((friend) => friend.id && !participantIdsSet.has(friend.id)),
    [friends, participantIdsSet],
  );

  const participantsForDisplay = conversationDisplay?.participants ?? [];
  const participantCount = participantsForDisplay.length;
  const canInviteMembers = Boolean(
    onAddConversationMembers && conversationDisplay?.isGroup && availableFriends.length > 0,
  );

  const isConversationSelected = Boolean(selectedConversationId);
  const isArchivedConversation = Boolean(conversationDisplay?.isArchived);
  const canArchiveConversation =
    Boolean(onArchiveConversation && onUnarchiveConversation && selectedConversationId);
  const searchDisabled = !isConversationSelected || !onSearchMessages;

  const mediaMessages = useMemo(
    () =>
      messages.filter(
        (message) => message.image || message.file || message.voiceRecording,
      ),
    [messages],
  );

  const linkMessages = useMemo(() => {
    const regex = /https?:\/\/[^\s]+/gi;
    const links: Array<{ id: string; url: string; sender?: string; createdAt: string }> = [];
    for (const message of messages) {
      if (!message.content) continue;
      const matches = message.content.match(regex);
      if (!matches) continue;
      matches.forEach((url, index) => {
        links.push({
          id: `${message.id}-${index}`,
          url,
          sender: message.sender,
          createdAt: message.createdAt,
        });
      });
    }
    return links;
  }, [messages]);

  useEffect(() => {
    const viewport = scrollAreaRef.current?.querySelector(
      '[data-radix-scroll-area-viewport]',
    );
    if (viewport) {
      viewport.scrollTop = viewport.scrollHeight;
    }
  }, [messages.length]);

  useEffect(() => {
    lastRequestedConversationRef.current = null;
  }, [conversationDisplay?.id]);

  useEffect(() => {
    if (!isConversationSelected) {
      setVoiceComposerState('idle');
    }
  }, [isConversationSelected]);

  useEffect(() => {
    setSearchResults([]);
    setSearchQuery('');
    setSearchError(null);
    setHasSearchedMessages(false);
    setSearchPopoverOpen(false);
  }, [selectedConversationId]);

  useEffect(() => {
    const baseTitle = conversationDisplay?.title ?? 'Cuộc trò chuyện';
    setNicknameInput(baseTitle);
    setNicknameDisplay(baseTitle);
    setBlockedUser(false);
    setIsBlocking(false);
  }, [conversationDisplay?.id, conversationDisplay?.title]);

  useEffect(() => {
    if (!conversationDisplay?.id) return;
    if (!onRetry) return;
    if (loading) return;
    if (messagesError) return;
    if (messages.length > 0) return;

    const convoId = conversationDisplay.id;
    if (lastRequestedConversationRef.current === convoId) return;
    lastRequestedConversationRef.current = convoId;
    onRetry();
  }, [messages.length, loading, messagesError, onRetry, conversationDisplay?.id]);

  const handleSubmit = () => {
    if (!inputValue.trim() || sending || !isConversationSelected) return;
    onSend();
  };

  const handleVoiceMessageStart = async () => {
    if (!isConversationSelected) return;
    if (voiceComposerState !== 'idle') return;
    setVoiceComposerState('recording');
    try {
      await onVoiceMessage?.();
    } catch (error) {
      console.error('Failed to start voice message recording:', error);
      setVoiceComposerState('idle');
    }
  };

  const handleEmojiSelect = (emoji: string) => {
    if (!isConversationSelected) return;
    onInputChange(`${inputValue}${emoji}`);
    setEmojiPickerOpen(false);
  };

  const formatFileSize = (inputSize?: number) => {
    if (typeof inputSize !== 'number' || Number.isNaN(inputSize) || inputSize <= 0) {
      return '';
    }
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    let size = inputSize;
    let unitIndex = 0;
    while (size >= 1024 && unitIndex < units.length - 1) {
      size /= 1024;
      unitIndex += 1;
    }
    const rounded =
      size >= 10 || Number.isInteger(size) ? Math.round(size) : Number(size.toFixed(1));
    return `${rounded} ${units[unitIndex]}`;
  };

  const scrollToMessage = (messageId: string) => {
    if (!scrollAreaRef.current) return;
    const viewport =
      scrollAreaRef.current.querySelector<HTMLElement>('[data-radix-scroll-area-viewport]');
    const container = viewport ?? scrollAreaRef.current;
    const target = container.querySelector<HTMLElement>(`[data-message-id="${messageId}"]`);
    if (target) {
      target.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  };

  const formatDateTime = (value?: string) => {
    if (!value) return '';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    return date.toLocaleString('vi-VN', {
      day: '2-digit',
      month: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const handleSelectSearchResult = (messageId: string) => {
    scrollToMessage(messageId);
    setHighlightMessageId(messageId);
    setSearchPopoverOpen(false);
    window.setTimeout(() => {
      setHighlightMessageId((current) => (current === messageId ? null : current));
    }, 2000);
  };

  const executeSearchMessages = async () => {
    if (!onSearchMessages || !selectedConversationId) {
      return;
    }
    const trimmed = searchQuery.trim();
    if (!trimmed) {
      setSearchResults([]);
      setSearchError('Vui lòng nhập nội dung cần tìm');
      setHasSearchedMessages(false);
      return;
    }
    setSearchingMessages(true);
    setHasSearchedMessages(true);
    try {
      const results = await onSearchMessages(selectedConversationId, trimmed);
      setSearchResults(results);
      setSearchError(null);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Không thể tìm kiếm tin nhắn';
      setSearchError(message);
    } finally {
      setSearchingMessages(false);
    }
  };

  const handleSearchSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void executeSearchMessages();
  };

  const handleSearchReset = () => {
    setSearchQuery('');
    setSearchResults([]);
    setSearchError(null);
    setHasSearchedMessages(false);
  };

  const handleRecallMessage = async (messageId: string) => {
    if (!onRecallMessage) {
      return;
    }
    setRecallingMessageId(messageId);
    try {
      await onRecallMessage(messageId);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Không thể thu hồi tin nhắn';
      window.alert(message);
    } finally {
      setRecallingMessageId(null);
    }
  };

  const handleToggleArchive = async () => {
    if (!selectedConversationId || !onArchiveConversation || !onUnarchiveConversation) {
      return;
    }
    setArchivePending(true);
    try {
      if (isArchivedConversation) {
        await onUnarchiveConversation(selectedConversationId);
      } else {
        await onArchiveConversation(selectedConversationId);
      }
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Không thể cập nhật trạng thái lưu trữ';
      window.alert(message);
    } finally {
      setArchivePending(false);
    }
  };

  const handleImageButtonClick = () => {
    if (!isConversationSelected) {
      window.alert('Vui lòng chọn một cuộc trò chuyện trước khi gửi ảnh.');
      return;
    }
    fileInputRef.current?.click();
  };

  const handleImageChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) {
      return;
    }
    if (!onSendImage) {
      window.alert('Tính năng gửi ảnh hiện chưa khả dụng.');
      return;
    }
    try {
      await onSendImage(file);
    } catch (error) {
      console.error('Failed to send image message:', error);
      window.alert('Không thể gửi ảnh. Vui lòng thử lại.');
    }
  };

  const handleFileButtonClick = () => {
    if (!isConversationSelected) {
      window.alert('Vui lòng chọn một cuộc trò chuyện trước khi gửi tệp.');
      return;
    }
    fileUploadInputRef.current?.click();
  };

  const handleFileChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) {
      return;
    }
    if (!onSendFile) {
      window.alert('Tính năng gửi tệp hiện chưa khả dụng.');
      return;
    }
    try {
      await onSendFile(file);
    } catch (error) {
      console.error('Failed to send file attachment:', error);
      window.alert('Không thể gửi tệp. Vui lòng thử lại.');
    }
  };

  const handleVoiceMessageStop = async () => {
    if (!isConversationSelected) return;
    if (voiceComposerState !== 'recording') return;
    setVoiceComposerState('review');
    let hasRecording = true;
    try {
      const result = await onVoiceMessageStop?.();
      if (typeof result === 'boolean') {
        hasRecording = result;
      }
    } catch (error) {
      console.error('Failed to stop voice message recording:', error);
      hasRecording = false;
    }

    if (!hasRecording) {
      window.alert('Không tìm thấy ghi âm. Vui lòng thử lại.');
      setVoiceComposerState('idle');
      return;
    }
  };

  const handleSaveNickname = () => {
    const trimmed = nicknameInput.trim();
    if (!trimmed) {
      setNicknameInput(conversationDisplay?.title ?? 'Cuộc trò chuyện');
      setNicknameDisplay(conversationDisplay?.title ?? 'Cuộc trò chuyện');
      return;
    }
    setNicknameDisplay(trimmed);
    window.alert('Biệt danh đã được cập nhật cục bộ cho cuộc trò chuyện này.');
  };

  const handleToggleBlockUser = async () => {
    if (!otherFriend && !otherParticipant) {
      window.alert('Không thể xác định người dùng để chặn.');
      return;
    }
    const name = otherFriend?.username ?? otherParticipant?.username ?? 'người dùng này';
    const actionLabel = blockedUser ? 'gỡ chặn' : 'chặn';
    const confirmed = window.confirm(`Bạn có chắc muốn ${actionLabel} ${name}?`);
    if (!confirmed) {
      return;
    }
    setIsBlocking(true);
    try {
      await new Promise((resolve) => setTimeout(resolve, 400));
      setBlockedUser((prev) => !prev);
      window.alert(
        blockedUser
          ? `${name} đã được gỡ chặn.`
          : `${name} đã bị chặn. Người này sẽ không thể gửi tin nhắn tới bạn (mô phỏng).`,
      );
    } finally {
      setIsBlocking(false);
    }
  };

  const handleDeleteConversation = async () => {
    if (!selectedConversationId || !onDeleteConversation) {
      window.alert('Tính năng xoá chưa khả dụng.');
      return;
    }
    const confirmed = window.confirm('Bạn có chắc muốn xoá hoàn toàn cuộc trò chuyện này?');
    if (!confirmed) {
      return;
    }
    setDeleteConversationPending(true);
    try {
      await onDeleteConversation(selectedConversationId);
      setInfoPanelOpen(false);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Không thể xoá cuộc trò chuyện. Vui lòng thử lại.';
      window.alert(message);
    } finally {
      setDeleteConversationPending(false);
    }
  };

  const handleLeaveGroup = async (mode: 'silent' | 'block') => {
    if (!selectedConversationId || !onLeaveConversation) {
      window.alert('Tính năng rời nhóm chưa khả dụng.');
      return;
    }
    const actionLabel =
      mode === 'block' ? 'rời nhóm và chặn thêm lại nhóm này' : 'rời nhóm trong im lặng';
    const confirmed = window.confirm(`Bạn có chắc muốn ${actionLabel}?`);
    if (!confirmed) {
      return;
    }
    setLeaveGroupPending(mode);
    try {
      await onLeaveConversation(selectedConversationId, { mode });
      setInfoPanelOpen(false);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Không thể rời nhóm. Vui lòng thử lại.';
      window.alert(message);
    } finally {
      setLeaveGroupPending(null);
    }
  };

  const openAddMembersModal = () => {
    setSelectedMemberIds([]);
    setAddMembersError(null);
    setAddMembersOpen(true);
  };

  const closeAddMembersModal = () => {
    if (addMembersLoading) {
      return;
    }
    setAddMembersOpen(false);
    setSelectedMemberIds([]);
    setAddMembersError(null);
  };

  const toggleMemberSelection = (friendId: string) => {
    setSelectedMemberIds((prev) =>
      prev.includes(friendId) ? prev.filter((id) => id !== friendId) : [...prev, friendId],
    );
  };

  const handleAddMembersSubmit = async () => {
    if (!selectedConversationId || !onAddConversationMembers) {
      return;
    }
    if (selectedMemberIds.length === 0) {
      setAddMembersError('Vui lòng chọn ít nhất một thành viên.');
      return;
    }
    setAddMembersLoading(true);
    setAddMembersError(null);
    try {
      await onAddConversationMembers(selectedConversationId, selectedMemberIds);
      setAddMembersOpen(false);
      setSelectedMemberIds([]);
      window.alert('Đã thêm thành viên mới vào nhóm');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Không thể thêm thành viên';
      setAddMembersError(message);
    } finally {
      setAddMembersLoading(false);
    }
  };

  const handleVoiceMessageCancel = async () => {
    if (voiceMessagePending) return;
    setVoiceComposerState('idle');
    try {
      await onVoiceMessageCancel?.();
    } catch (error) {
      console.error('Failed to cancel voice message recording:', error);
    }
  };

  const executeVoiceMessageSend = () => {
    if (voiceMessagePending) return;
    const finalize = () => setVoiceComposerState('idle');
    if (onVoiceMessageSend) {
      Promise.resolve(onVoiceMessageSend())
        .catch((error) => {
          console.error('Failed to send voice message:', error);
        })
        .finally(finalize);
      return;
    }
    finalize();
  };

  const handleVoiceMessageSend = () => {
    if (!isConversationSelected) return;
    if (voiceComposerState !== 'review') return;
    if (!voiceRecordingReady) {
      window.alert('Ghi âm chưa sẵn sàng. Vui lòng đợi trong giây lát.');
      return;
    }
    executeVoiceMessageSend();
  };

  const handleVoiceMessageSendDirect = async () => {
    if (!isConversationSelected) return;
    if (voiceMessagePending) return;
    if (voiceComposerState !== 'recording') {
      handleVoiceMessageSend();
      return;
    }
    setVoiceComposerState('review');
    let hasRecording = true;
    try {
      const result = await onVoiceMessageStop?.();
      if (typeof result === 'boolean') {
        hasRecording = result;
      }
    } catch (error) {
      console.error('Failed to stop voice message before sending:', error);
      hasRecording = false;
    }
    if (!hasRecording) {
      window.alert('Ghi âm chưa sẵn sàng. Vui lòng thử lại.');
      setVoiceComposerState('idle');
      return;
    }
    executeVoiceMessageSend();
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      handleSubmit();
    }
  };

  const renderBody = () => {
    if (!isConversationSelected) {
      return (
        <div className="flex flex-col items-center justify-center gap-2 py-12 text-center text-muted-theme">
          <p>Chưa chọn cuộc trò chuyện nào</p>
          <p className="text-sm">Hãy chọn một cuộc trò chuyện từ danh sách bên trái để bắt đầu.</p>
        </div>
      );
    }
    
    // Show loading only when actually loading messages
    if (loading && messages.length === 0) {
      return <p className="text-center text-sm text-muted-theme">Đang tải tin nhắn...</p>;
    }
    
    if (messagesError && messages.length === 0) {
      return (
        <div className="flex flex-col items-center gap-3 rounded-xl border border-red-200 bg-red-50 p-4 text-center text-red-600">
          <p>{messagesError}</p>
          {onRetry && (
            <Button variant="outline" size="sm" onClick={onRetry}>
              Thử lại
            </Button>
          )}
        </div>
      );
    }
    
    if (messages.length === 0 && !loading) {
      return (
        <div className="flex flex-col items-center justify-center gap-2 py-12 text-center text-muted-theme">
          <p>Chưa có tin nhắn nào trong cuộc trò chuyện này</p>
          <p className="text-sm">Hãy bắt đầu cuộc trò chuyện đầu tiên nhé!</p>
        </div>
      );
    }

    return (
      <div className="space-y-3">
        {messages.map((message) => {
          const senderName = message.sender?.trim() || 'Người dùng';
          const normalizedSender = senderName.toLowerCase();
          const participant = normalizedSender ? participantLookup.get(normalizedSender) : undefined;
          const displayName = participant?.username || senderName;
          const avatarUrl = participant?.avatarUrl ?? null;
          const avatarInitials = getInitials(displayName);
          const normalizedSenderName = message.sender?.toLowerCase();
          const normalizedCurrentUserName = currentUserName?.toLowerCase();
          const isCurrentUser =
            (currentUserId && message.senderId && message.senderId === currentUserId) ||
            (normalizedCurrentUserName && normalizedSenderName === normalizedCurrentUserName);
          const timestamp = new Date(message.createdAt);
          const hasError = Boolean(message.error);
          const seenSet = new Set((message.seenBy ?? []).map(String));
          const messageStatusLabel =
            !message.isRecalled && isCurrentUser && otherParticipantIds.length > 0
              ? otherParticipantIds.every((id) => seenSet.has(id))
                ? 'Đã xem'
                : 'Đã gửi'
              : null;
          const messageStatusClass =
            messageStatusLabel === 'Đã xem' ? 'text-green-600' : 'text-muted-theme';
          const shouldHighlight = highlightMessageId === message.id;
          const showRecallAction =
            Boolean(onRecallMessage) && isCurrentUser && !message.isRecalled && !message.error;

          const urlsInMessage = message.content ? extractUrls(message.content) : [];
          const firstUrl = urlsInMessage[0];

          return (
            <div
              key={message.id}
              data-message-id={message.id}
              className={`flex gap-2 ${isCurrentUser ? 'flex-row-reverse' : 'flex-row'}`}
            >
              {!isCurrentUser && (
                <Avatar className="size-8 flex-shrink-0">
                  {avatarUrl ? <AvatarImage src={avatarUrl} alt={displayName} /> : null}
                  <AvatarFallback className="bg-blue-500 text-xs font-semibold text-white">
                    {avatarInitials || (conversationDisplay?.avatarFallback ?? 'U')}
                  </AvatarFallback>
                </Avatar>
              )}

              <div
                className={`flex max-w-[80%] flex-col ${
                  isCurrentUser ? 'items-end text-right' : 'items-start'
                }`}
              >
                {conversationDisplay?.isGroup && (
                  <span
                    className={`mb-1 text-xs font-semibold ${
                      isCurrentUser ? 'self-end text-blue-200' : 'text-muted-theme'
                    }`}
                  >
                    {isCurrentUser ? 'Bạn' : displayName}
                  </span>
                )}
                <div
                  className={
                    message.image
                      ? undefined
                      : `chat-bubble ${
                          isCurrentUser ? 'chat-bubble--outgoing' : 'chat-bubble--incoming'
                        } ${hasError ? 'border border-red-300 bg-red-50' : ''} ${
                          shouldHighlight ? 'ring-2 ring-blue-200' : ''
                        }`
                  }
                >
                  {message.isRecalled ? (
                    <p className="text-sm italic text-muted-theme">Tin nhắn đã được thu hồi</p>
                  ) : message.voiceRecording ? (
                    <div className="flex flex-col gap-2">
                      {message.voiceRecording.dataUrl || message.voiceRecording.url ? (
                        <audio
                          controls
                          preload="metadata"
                          src={message.voiceRecording.dataUrl || message.voiceRecording.url}
                          className="w-60 max-w-full"
                        >
                          Trình duyệt của bạn không hỗ trợ phát tin nhắn thoại.
                        </audio>
                      ) : (
                        <p className="text-sm text-muted-theme">Không thể phát tin nhắn thoại.</p>
                      )}
                      {message.voiceRecording.originalName && (
                        <p className="text-xs text-muted-theme">
                          {message.voiceRecording.originalName}
                        </p>
                      )}
                      {message.content && (
                        <p className="text-xs text-muted-theme whitespace-pre-line break-words">
                          {renderTextWithLinks(message.content)}
                        </p>
                      )}
                    </div>
                  ) : message.image ? (
                    <>
                      {message.image.dataUrl || message.image.url ? (
                        <img
                          src={message.image.dataUrl || message.image.url}
                          alt={message.image.originalName || message.image.fileName || 'Hình ảnh'}
                          loading="lazy"
                          className="max-h-96 w-auto max-w-full rounded-2xl object-cover"
                        />
                      ) : (
                        <p className="text-sm text-muted-theme">Không thể hiển thị hình ảnh.</p>
                      )}
                    </>
                  ) : message.file ? (
                    <>
                      {(message.file.url || message.file.dataUrl) ? (
                        <a
                          className="inline-flex max-w-full items-center gap-2 text-sm font-semibold hover:underline"
                          href={message.file.url ?? message.file.dataUrl ?? '#'}
                          download={message.file.originalName || message.file.fileName || 'file'}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          <FileText className="size-4 shrink-0" />
                          <span className="truncate">
                            {message.file.originalName ||
                              message.file.fileName ||
                              'Tải xuống tệp'}
                          </span>
                          {formatFileSize(message.file.size) ? (
                            <span className="text-xs font-normal">
                              {formatFileSize(message.file.size)}
                            </span>
                          ) : null}
                        </a>
                      ) : (
                        <p className="text-sm text-muted-theme">Không thể tải tệp.</p>
                      )}
                    </>
                  ) : (
                    <>
                      <p className="whitespace-pre-line break-words">
                        {renderTextWithLinks(message.content)}
                      </p>
                      {firstUrl ? <LinkPreviewCard url={firstUrl} /> : null}
                    </>
                  )}
                  {hasError && (
                    <p className="mt-1 text-xs text-red-600">{message.error}</p>
                  )}
                </div>
                <div className="mt-1 flex items-center gap-2 text-xs text-subtle-theme">
                  <span>
                    {timestamp.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })}
                  </span>
                  {showRecallAction && (
                    <button
                      type="button"
                      className="font-semibold text-blue-600 transition hover:underline disabled:cursor-not-allowed disabled:text-subtle-theme"
                      disabled={recallingMessageId === message.id}
                      onClick={() => handleRecallMessage(message.id)}
                    >
                      {recallingMessageId === message.id ? 'Đang thu hồi...' : 'Thu hồi'}
                    </button>
                  )}
                  {isCurrentUser && messageStatusLabel && (
                    <span className={`font-medium ${messageStatusClass}`}>{messageStatusLabel}</span>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    );
  };

  return (
    <div className="chat-interface">
      <div className="chat-interface__header">
        <div
          className={`flex w-full items-center ${
            isMobile ? 'flex-wrap gap-3' : 'gap-6'
          }`}
        >
          {isMobile && (
            <Button
              variant="ghost"
              size="icon"
              className="rounded-full sm:hidden"
              onClick={() => onOpenSidebar?.()}
              title="Mở danh sách cuộc trò chuyện"
              aria-label="Mở danh sách cuộc trò chuyện"
            >
              <Menu className="size-5 text-muted-theme" />
            </Button>
          )}
          {isConversationSelected ? (
            <>
              <div className="flex min-w-0 flex-1 items-center gap-3">
                <Avatar className="size-12">
                  <AvatarFallback className="bg-blue-500 text-lg font-semibold text-white">
                    {conversationDisplay?.avatarFallback ??
                      getInitials(conversationDisplay?.title ?? 'Chat')}
                  </AvatarFallback>
                </Avatar>
                <div>
                  <h3 className="text-base font-semibold">
                    {nicknameDisplay || conversationDisplay?.title || 'Cuộc trò chuyện'}
                  </h3>
                  <p className={`flex items-center gap-1 text-sm ${statusClass}`}>
                    {!conversationDisplay?.isGroup && otherFriend?.isOnline && (
                      <span className="inline-block size-2 rounded-full bg-green-500" />
                    )}
                    {statusLabel || 'Đang hoạt động'}
                  </p>
                </div>
              </div>
              <div
                className={`flex items-center gap-2 ${
                  isMobile ? 'w-full flex-wrap justify-end' : 'ml-auto'
                }`}
              >
                <Popover
                  open={searchPopoverOpen}
                  onOpenChange={(open) => {
                    setSearchPopoverOpen(open);
                    if (open) {
                      setTimeout(() => searchInputRef.current?.focus(), 0);
                    }
                  }}
                >
                  <PopoverTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="rounded-full"
                      disabled={searchDisabled}
                      title="Tìm kiếm tin nhắn"
                      aria-label="Tìm kiếm tin nhắn"
                    >
                      <Search className="size-5 text-blue-500" />
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent
                    className="w-80 border theme-border bg-[var(--surface-bg)] p-4 text-[var(--text-primary)] shadow-lg animate-scale-pop"
                    align="end"
                  >
                    <form className="space-y-2" onSubmit={handleSearchSubmit}>
                      <Input
                        ref={searchInputRef}
                        type="text"
                        value={searchQuery}
                        onChange={(event) => setSearchQuery(event.target.value)}
                        placeholder="Nhập nội dung cần tìm"
                        disabled={searchDisabled}
                      />
                      <div className="flex items-center gap-2">
                        <Button
                          type="submit"
                          size="sm"
                          className="rounded-full"
                          disabled={searchingMessages || searchDisabled || !searchQuery.trim()}
                        >
                          {searchingMessages ? (
                            <Loader2 className="mr-2 size-4 animate-spin" />
                          ) : (
                            <Search className="mr-2 size-4" />
                          )}
                          Tìm kiếm
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="rounded-full"
                          onClick={handleSearchReset}
                          disabled={searchingMessages}
                        >
                          Xóa
                        </Button>
                      </div>
                    </form>
                    {searchError && hasSearchedMessages && (
                      <p className="mt-2 text-xs text-red-600">{searchError}</p>
                    )}
                    {!searchError && hasSearchedMessages && searchResults.length === 0 && (
                      <p className="mt-2 text-xs text-muted-theme">Không tìm thấy tin nhắn phù hợp.</p>
                    )}
                    {searchResults.length > 0 && (
                      <div className="mt-3 max-h-64 space-y-2 overflow-auto pr-1">
                        {searchResults.map((result) => {
                          const snippet = result.isRecalled
                            ? 'Tin nhắn đã được thu hồi'
                            : result.content || 'Tin nhắn';
                          const resultTime = new Date(result.createdAt).toLocaleString('vi-VN', {
                            day: '2-digit',
                            month: '2-digit',
                            hour: '2-digit',
                            minute: '2-digit',
                          });
                          return (
                            <button
                              key={result.id}
                              type="button"
                              onClick={() => handleSelectSearchResult(result.id)}
                              className="w-full rounded-lg border theme-border px-3 py-2 text-left text-sm text-[var(--text-primary)] transition hover:bg-blue-500/10"
                            >
                              <p className="font-semibold text-[var(--text-primary)]">{result.sender || 'Người dùng'}</p>
                              <p className="text-xs text-muted-theme">{resultTime}</p>
                              <p className="mt-1 truncate text-sm text-muted-theme">{snippet}</p>
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </PopoverContent>
                </Popover>
                {canArchiveConversation && (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="rounded-full"
                    title={
                      isArchivedConversation ? 'Bỏ lưu trữ cuộc trò chuyện' : 'Lưu trữ cuộc trò chuyện'
                    }
                    aria-label={
                      isArchivedConversation ? 'Bỏ lưu trữ cuộc trò chuyện' : 'Lưu trữ cuộc trò chuyện'
                    }
                    disabled={archivePending}
                    onClick={handleToggleArchive}
                  >
                    {archivePending ? (
                      <Loader2 className="size-4 animate-spin text-blue-500" />
                    ) : isArchivedConversation ? (
                      <ArchiveRestore className="size-5 text-blue-500" />
                    ) : (
                      <Archive className="size-5 text-blue-500" />
                    )}
                  </Button>
                )}
                {canStartCall && (
                  <>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="rounded-full"
                      onClick={onStartVoiceCall}
                      disabled={!isConversationSelected || callButtonsDisabled}
                      title="Gọi thoại"
                      aria-label="Gọi thoại"
                    >
                      <Phone className="size-5 text-blue-500" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="rounded-full"
                      onClick={onStartVideoCall}
                      disabled={!isConversationSelected || callButtonsDisabled}
                      title="Gọi video"
                      aria-label="Gọi video"
                    >
                      <Video className="size-5 text-blue-500" />
                    </Button>
                  </>
                )}
                <Button
                  variant="ghost"
                  size="icon"
                  className="rounded-full"
                  onClick={() => setInfoPanelOpen(true)}
                  aria-label="Mở thông tin cuộc trò chuyện"
                >
                  <Info className="size-5 text-blue-500" />
                </Button>
              </div>
            </>
          ) : (
          <div className="flex w-full items-center justify-between">
            <div>
              <h3 className="text-base font-semibold text-[var(--text-primary)]">
                Chưa chọn cuộc trò chuyện
              </h3>
              <p className="text-sm text-muted-theme">
                Hãy chọn một cuộc trò chuyện từ danh sách để xem tin nhắn.
              </p>
            </div>
          </div>
        )}
        </div>
      </div>

      <Sheet open={infoPanelOpen} onOpenChange={setInfoPanelOpen}>
        <SheetContent
          side="right"
          className="flex h-full max-h-screen w-full max-w-full flex-col overflow-hidden p-0 sm:h-auto sm:max-w-md"
        >
          <SheetHeader className="border-b px-6 py-4 text-left">
            <SheetTitle>Thông tin cuộc trò chuyện</SheetTitle>
            <SheetDescription>
              Quản lý người tham gia, nội dung và các tuỳ chọn bổ sung.
            </SheetDescription>
          </SheetHeader>
          <ScrollArea className="flex-1 min-h-0">
            <div className="space-y-6 px-6 py-6">
              <section className="surface-card p-4 animate-fade-slide">
                <div className="flex items-center gap-3">
                  <Avatar className="size-12">
                    <AvatarFallback className="bg-blue-500 text-lg font-semibold text-white">
                      {conversationDisplay?.avatarFallback ??
                        getInitials(conversationDisplay?.title ?? 'Chat')}
                    </AvatarFallback>
                  </Avatar>
                  <div>
                    <p className="text-base font-semibold text-[var(--text-primary)]">
                      {nicknameDisplay || conversationDisplay?.title || 'Cuộc trò chuyện'}
                    </p>
                    <p className="text-sm text-muted-theme">{statusLabel || 'Đang hoạt động'}</p>
                  </div>
                </div>
                {otherFriend && (
                  <p className="mt-3 text-xs text-muted-theme">
                    Email:{' '}
                    <span className="font-medium text-[var(--text-primary)]">{otherFriend.email}</span>
                  </p>
                )}
              </section>

              {conversationDisplay?.isGroup ? (
                <section className="surface-card p-4 animate-fade-slide">
                  <h3 className="text-sm font-semibold text-[var(--text-primary)]">Rời nhóm</h3>
                  <p className="text-xs text-muted-theme">
                    Thoát khỏi nhóm theo cách bạn muốn. Rời trong im lặng sẽ không gửi thông báo;
                    &quot;Rời và chặn&quot; sẽ chặn bạn được thêm lại (mô phỏng).
                  </p>
                  <div className="mt-3 flex flex-col gap-2 sm:flex-row">
                    <Button
                      type="button"
                      variant="outline"
                      className="rounded-full"
                      onClick={() => handleLeaveGroup('silent')}
                      disabled={!onLeaveConversation || leaveGroupPending === 'silent'}
                    >
                      {leaveGroupPending === 'silent' ? (
                        <Loader2 className="mr-2 size-4 animate-spin" />
                      ) : null}
                      Rời im lặng
                    </Button>
                    <Button
                      type="button"
                      className="rounded-full bg-red-600 text-white hover:bg-red-700"
                      onClick={() => handleLeaveGroup('block')}
                      disabled={!onLeaveConversation || leaveGroupPending === 'block'}
                    >
                      {leaveGroupPending === 'block' ? (
                        <Loader2 className="mr-2 size-4 animate-spin" />
                      ) : (
                        <Shield className="mr-2 size-4" />
                      )}
                      Rời &amp; chặn
                    </Button>
                  </div>
                </section>
              ) : (
                <section className="surface-card p-4 animate-fade-slide">
                  <div className="flex items-center justify-between">
                    <div>
                      <h3 className="text-sm font-semibold text-[var(--text-primary)]">Chặn người dùng</h3>
                      <p className="text-xs text-muted-theme">
                        {blockedUser
                          ? 'Người dùng này đang bị chặn. Bạn sẽ không nhận tin nhắn (mô phỏng).'
                          : 'Ngăn người này nhắn tin hoặc gọi cho bạn (mô phỏng).'}
                      </p>
                    </div>
                    <Button
                      type="button"
                      variant={blockedUser ? 'outline' : 'ghost'}
                      className={blockedUser ? 'text-[var(--text-primary)]' : 'text-red-600'}
                      onClick={handleToggleBlockUser}
                      disabled={isBlocking}
                    >
                      {isBlocking ? (
                        <Loader2 className="mr-2 size-4 animate-spin" />
                      ) : (
                        <Shield className="mr-2 size-4" />
                      )}
                      {blockedUser ? 'Gỡ chặn' : 'Chặn'}
                    </Button>
                  </div>
                </section>
              )}

              {conversationDisplay?.isGroup && (
                <section className="surface-card p-4 animate-fade-slide">
                  <div className="flex items-center justify-between">
                    <div>
                      <h3 className="text-sm font-semibold text-[var(--text-primary)]">Thành viên</h3>
                      <p className="text-xs text-muted-theme">{participantCount} thành viên</p>
                    </div>
                    {onAddConversationMembers && (
                      <Button
                        type="button"
                        size="sm"
                        className="rounded-full"
                        onClick={openAddMembersModal}
                        disabled={!canInviteMembers}
                        title={
                          canInviteMembers
                            ? 'Thêm thành viên mới'
                            : 'Không còn bạn bè nào để thêm'
                        }
                      >
                        <UserPlus className="mr-2 size-4" />
                        Thêm
                      </Button>
                    )}
                  </div>
                  <div className="mt-3 max-h-60 space-y-2 overflow-y-auto pr-2">
                    {participantCount === 0 ? (
                      <p className="text-sm text-muted-theme">Chưa có thành viên nào.</p>
                    ) : (
                      participantsForDisplay.map((participant) => (
                        <div
                          key={participant?.id ?? participant?.email ?? participant?.username}
                          className="flex items-center justify-between rounded-lg border theme-border bg-[var(--surface-bg)] px-3 py-2 text-sm"
                        >
                          <div className="flex items-center gap-3">
                            <Avatar className="size-8">
                              <AvatarFallback className="bg-blue-500 text-white">
                                {getInitials(participant?.username ?? participant?.email ?? 'U')}
                              </AvatarFallback>
                              {participant?.avatarUrl ? (
                                <AvatarImage src={participant.avatarUrl} alt={participant.username} />
                              ) : null}
                            </Avatar>
                            <div>
                              <p className="text-sm font-semibold text-[var(--text-primary)]">
                                {participant?.username ?? 'Người dùng'}
                                {participant?.id && participant.id === currentUserId ? (
                                  <span className="ml-2 rounded-full bg-blue-500/10 px-2 py-0.5 text-xs font-medium text-blue-600">
                                    Bạn
                                  </span>
                                ) : null}
                              </p>
                              {participant?.email ? (
                                <p className="text-xs text-muted-theme">{participant.email}</p>
                              ) : null}
                            </div>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </section>
              )}

              <section className="surface-card p-4 animate-fade-slide">
                <h3 className="text-sm font-semibold text-[var(--text-primary)]">Biệt danh</h3>
                <p className="text-xs text-muted-theme">
                  Đặt tên riêng để dễ tìm kiếm cuộc trò chuyện này trên thiết bị của bạn.
                </p>
                <div className="mt-3 flex flex-col gap-2 sm:flex-row">
                  <Input
                    value={nicknameInput}
                    onChange={(event) => setNicknameInput(event.target.value)}
                    placeholder="Nhập biệt danh"
                  />
                  <Button type="button" onClick={handleSaveNickname}>
                    Lưu
                  </Button>
                </div>
              </section>

              <section className="surface-card p-4 animate-fade-slide">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-semibold text-[var(--text-primary)]">
                    File & phương tiện
                  </h3>
                  <span className="text-xs text-muted-theme">{mediaMessages.length}</span>
                </div>
                {mediaMessages.length === 0 ? (
                  <p className="mt-3 text-xs text-muted-theme">
                    Chưa có file hoặc phương tiện nào trong cuộc trò chuyện này.
                  </p>
                ) : (
                  <div className="mt-3 space-y-3">
                    {mediaMessages.map((message) => {
                      const isImage = Boolean(message.image);
                      const isFile = Boolean(message.file);
                      const typeLabel = isImage
                        ? 'Hình ảnh'
                        : isFile
                          ? 'Tệp đính kèm'
                          : 'Ghi âm';
                      const href =
                        message.image?.url ??
                        message.image?.dataUrl ??
                        message.file?.url ??
                        message.file?.dataUrl ??
                        message.voiceRecording?.url ??
                        message.voiceRecording?.dataUrl ??
                        '#';
                      const name =
                        message.image?.originalName ||
                        message.file?.originalName ||
                        message.voiceRecording?.originalName ||
                        typeLabel;
                      return (
                        <div
                          key={message.id}
                          className="flex items-center justify-between rounded-lg border theme-border bg-[var(--surface-bg)] px-3 py-2 text-sm transition-colors"
                        >
                          <div>
                            <p className="font-semibold text-[var(--text-primary)]">{name}</p>
                            <p className="text-xs text-muted-theme">
                              {typeLabel} • {formatDateTime(message.createdAt)}
                            </p>
                          </div>
                          {href !== '#' && (
                            <Button asChild variant="outline" size="sm" className="rounded-full">
                              <a href={href} target="_blank" rel="noopener noreferrer">
                                <Download className="mr-2 size-4" />
                                Xem
                              </a>
                            </Button>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </section>

              <section className="surface-card p-4 animate-fade-slide">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-semibold text-[var(--text-primary)]">Liên kết</h3>
                  <span className="text-xs text-muted-theme">{linkMessages.length}</span>
                </div>
                {linkMessages.length === 0 ? (
                  <p className="mt-3 text-xs text-muted-theme">
                    Chưa có liên kết nào được chia sẻ.
                  </p>
                ) : (
                  <div className="mt-3 space-y-2">
                    {linkMessages.map((link) => (
                      <div
                        key={link.id}
                        className="flex items-center justify-between rounded-lg border theme-border bg-[var(--surface-bg)] px-3 py-2 text-sm transition-colors"
                      >
                        <div className="min-w-0 pr-3">
                          <p className="truncate font-semibold text-[var(--text-primary)]">
                            {link.url}
                          </p>
                          <p className="text-xs text-muted-theme">
                            {link.sender ?? 'Người dùng'} • {formatDateTime(link.createdAt)}
                          </p>
                        </div>
                        <Button asChild variant="ghost" size="icon" className="text-blue-600">
                          <a href={link.url} target="_blank" rel="noopener noreferrer">
                            <LinkIcon className="size-4" />
                          </a>
                        </Button>
                      </div>
                    ))}
                  </div>
                )}
              </section>

              <section className="rounded-xl border border-red-200 bg-red-50 p-4 dark:border-red-900/60 dark:bg-red-500/10">
                <h3 className="text-sm font-semibold text-red-800">Xoá cuộc trò chuyện</h3>
                <p className="text-xs text-red-700">
                  Hành động này không thể hoàn tác. {conversationDisplay?.isGroup
                    ? 'Bạn chỉ có thể xoá cuộc trò chuyện nhóm khi không còn thành viên nào khác.'
                    : 'Tất cả tin nhắn sẽ bị xoá cho cả hai phía.'}
                </p>
                <Button
                  type="button"
                  className="mt-3 rounded-full bg-red-600 text-white hover:bg-red-700"
                  onClick={handleDeleteConversation}
                  disabled={!onDeleteConversation || deleteConversationPending}
                >
                  {deleteConversationPending ? (
                    <Loader2 className="mr-2 size-4 animate-spin" />
                  ) : (
                    <Trash2 className="mr-2 size-4" />
                  )}
                  Xoá cuộc trò chuyện
                </Button>
              </section>
            </div>
          </ScrollArea>
        </SheetContent>
      </Sheet>

      <ScrollArea ref={scrollAreaRef} className="chat-interface__messages h-full">
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 px-4 py-4">
          {renderBody()}
        </div>
      </ScrollArea>

      <div className="chat-interface__composer">
        <div className="mx-auto flex w-full max-w-3xl flex-wrap items-center gap-3 sm:flex-nowrap">
          {voiceComposerState === 'idle' && (
            <>
              <input
                type="file"
                accept="image/*"
                ref={fileInputRef}
                onChange={handleImageChange}
                className="hidden"
              />
            <input
              type="file"
              ref={fileUploadInputRef}
              onChange={handleFileChange}
              className="hidden"
            />
              <div className="flex flex-1 items-center gap-2">
                <div className="flex items-center gap-2">
                  <Button
                    onClick={handleImageButtonClick}
                    size="icon"
                    className="rounded-full"
                    variant="outline"
                    disabled={!isConversationSelected}
                    title="Gửi hình ảnh"
                    aria-label="Gửi hình ảnh"
                  >
                    <ImageIcon className="size-4" />
                  </Button>
                <Button
                  onClick={handleFileButtonClick}
                  size="icon"
                  className="rounded-full"
                  variant="outline"
                  disabled={!isConversationSelected}
                  title="Gửi tệp"
                  aria-label="Gửi tệp"
                >
                  <Paperclip className="size-4" />
                </Button>
                  <Button
                    onClick={handleVoiceMessageStart}
                    size="icon"
                    className="rounded-full"
                    variant="outline"
                    disabled={!isConversationSelected}
                    title="Gửi tin nhắn thoại"
                    aria-label="Gửi tin nhắn thoại"
                  >
                    <Mic className="size-4" />
                  </Button>
                </div>
              <Input
                type="text"
                placeholder={isConversationSelected ? 'Aa' : 'Chọn cuộc trò chuyện để nhắn tin'}
                value={inputValue}
                onChange={(event) => onInputChange(event.target.value)}
                onKeyDown={handleKeyDown}
                disabled={sending || !isConversationSelected}
                className="flex-1 min-w-0 rounded-full border border-transparent bg-[var(--surface-bg)] text-[var(--text-primary)] transition-colors focus-visible:border-blue-500/50"
              />
                <div className="flex items-center gap-2">
                  <Popover open={emojiPickerOpen} onOpenChange={setEmojiPickerOpen}>
                    <PopoverTrigger asChild>
                      <Button
                        type="button"
                        size="icon"
                        variant="outline"
                        className="rounded-full"
                        disabled={!isConversationSelected}
                        title="Chọn emoji"
                        aria-label="Chọn emoji"
                      >
                        <Smile className="size-4" />
                      </Button>
                    </PopoverTrigger>
                  <PopoverContent
                    className="w-64 border theme-border bg-[var(--surface-bg)] p-2 text-[var(--text-primary)] shadow-lg animate-scale-pop"
                    align="end"
                  >
                      <div className="grid grid-cols-8 gap-2">
                        {[
                          '😀',
                          '😁',
                          '😂',
                          '🤣',
                          '😄',
                          '😅',
                          '😊',
                          '😍',
                          '😘',
                          '😗',
                          '😙',
                          '😚',
                          '🙂',
                          '🤗',
                          '🤩',
                          '🤔',
                          '😎',
                          '😪',
                          '😭',
                          '😤',
                          '😡',
                          '🥳',
                          '😇',
                          '🤤',
                          '😴',
                          '👍',
                          '👎',
                          '🙏',
                          '👏',
                          '🙌',
                          '💪',
                          '🎉',
                          '❤️',
                          '💖',
                          '💔',
                          '🔥',
                          '✨',
                          '💯',
                          '🌟',
                          '🧠',
                          '🎧',
                          '🥰',
                          '🤯',
                          '🤝',
                          '☕',
                          '🍀',
                        ].map(
                          (emoji) => (
                            <button
                              key={emoji}
                              type="button"
                              className="text-xl transition hover:scale-110"
                              onClick={() => handleEmojiSelect(emoji)}
                            >
                              {emoji}
                            </button>
                          ),
                        )}
                      </div>
                    </PopoverContent>
                  </Popover>
                  <Button
                    onClick={handleSubmit}
                    size="icon"
                    className="rounded-full"
                    disabled={sending || !inputValue.trim() || !isConversationSelected}
                    title="Gửi tin nhắn"
                    aria-label="Gửi tin nhắn"
                  >
                    <Send className="size-4" />
                  </Button>
                </div>
              </div>
            </>
          )}

          {voiceComposerState === 'recording' && (
            <>
              <div className="flex flex-1 items-center justify-between rounded-full bg-red-50 px-4 py-3 text-sm font-medium text-red-600">
                <span>Đang ghi âm...</span>
              </div>
              <Button
                onClick={handleVoiceMessageStop}
                size="icon"
                className="rounded-full bg-red-500 text-white hover:bg-red-600"
                title="Dừng ghi âm"
                aria-label="Dừng ghi âm"
              >
                <Square className="size-4" />
              </Button>
              <Button
                onClick={handleVoiceMessageSendDirect}
                size="icon"
                className="rounded-full"
                disabled={voiceMessagePending}
                title="Gửi tin nhắn thoại"
                aria-label="Gửi tin nhắn thoại"
              >
                <Send className="size-4" />
              </Button>
              <Button
                onClick={handleVoiceMessageCancel}
                variant="ghost"
                className="rounded-full"
                title="Hủy ghi âm"
                aria-label="Hủy ghi âm"
              >
                Hủy
              </Button>
            </>
          )}

          {voiceComposerState === 'review' && (
            <>
              <div className="flex flex-1 items-center justify-between rounded-full bg-[var(--composer-bg)] px-4 py-3 text-sm text-muted-theme">
                <span>{voiceRecordingReady ? 'Ghi âm sẵn sàng để gửi' : 'Đang xử lý ghi âm...'}</span>
              </div>
              <Button
                onClick={handleVoiceMessageCancel}
                variant="ghost"
                className="rounded-full"
                title="Ghi lại"
                aria-label="Ghi lại"
                disabled={voiceMessagePending}
              >
                Ghi lại
              </Button>
              <Button
                onClick={handleVoiceMessageSend}
                size="icon"
                className="rounded-full"
                disabled={voiceMessagePending || !voiceRecordingReady}
                title="Gửi tin nhắn thoại"
                aria-label="Gửi tin nhắn thoại"
              >
                <Send className="size-4" />
              </Button>
            </>
          )}
        </div>
      </div>

      {addMembersOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[var(--overlay-backdrop)] px-4 py-6">
          <div className="glass-panel w-full max-w-lg rounded-[28px] p-6 text-[var(--text-primary)] animate-scale-pop">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-lg font-semibold">Thêm thành viên vào nhóm</h3>
                <p className="text-sm text-muted-theme">
                  Chọn bạn bè để mời vào cuộc trò chuyện này.
                </p>
              </div>
              <button
                type="button"
                onClick={closeAddMembersModal}
                className="rounded-full p-2 text-subtle-theme transition hover:bg-blue-500/10"
                aria-label="Đóng"
              >
                <X className="size-5" />
              </button>
            </div>

            <div className="mt-4 max-h-[320px] space-y-3 overflow-y-auto pr-2">
              {availableFriends.length === 0 ? (
                <div className="rounded-xl border border-dashed theme-border px-4 py-5 text-center text-sm text-muted-theme">
                  Bạn không còn bạn bè nào có thể thêm.
                </div>
              ) : (
                availableFriends.map((friend) => (
                  <label
                    key={friend.id}
                    className="flex cursor-pointer items-center gap-3 rounded-xl border theme-border bg-[var(--surface-bg)] px-3 py-2 text-sm transition hover:border-blue-300 dark:hover:border-blue-500"
                  >
                    <input
                      type="checkbox"
                      className="size-4 accent-blue-500"
                      checked={selectedMemberIds.includes(friend.id)}
                      onChange={() => toggleMemberSelection(friend.id)}
                      disabled={addMembersLoading}
                    />
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-[var(--text-primary)]">
                        {friend.username}
                      </p>
                      {friend.email ? (
                        <p className="text-xs text-muted-theme">{friend.email}</p>
                      ) : null}
                    </div>
                  </label>
                ))
              )}
            </div>

            {addMembersError && (
              <p className="mt-4 text-sm text-red-600 dark:text-red-400">{addMembersError}</p>
            )}

            <div className="mt-6 flex flex-col gap-2 sm:flex-row sm:justify-end">
              <Button type="button" variant="outline" className="rounded-full" onClick={closeAddMembersModal} disabled={addMembersLoading}>
                Huỷ
              </Button>
              <Button
                type="button"
                className="rounded-full"
                onClick={handleAddMembersSubmit}
                disabled={addMembersLoading || selectedMemberIds.length === 0}
              >
                {addMembersLoading ? (
                  <>
                    <Loader2 className="mr-2 size-4 animate-spin" />
                    Đang thêm...
                  </>
                ) : (
                  <>
                    <UserPlus className="mr-2 size-4" />
                    Thêm thành viên
                  </>
                )}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
