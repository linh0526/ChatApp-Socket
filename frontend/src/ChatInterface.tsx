import { useEffect, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { Info, Menu, Mic, Phone, Send, Square, Video } from 'lucide-react';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Avatar, AvatarFallback, AvatarImage } from './ui/avatar';
import { ScrollArea } from './ui/scroll-area';
import type { ConversationPreview } from './ChatLayout';
import type { ChatMessage } from './chatTypes';

interface ChatInterfaceProps {
  conversation?: ConversationPreview;
  selectedConversationId?: string | null;
  messages: ChatMessage[];
  messagesError?: string | null;
  currentUserName?: string | null;
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
  isMobile = false,
  onOpenSidebar,
}: ChatInterfaceProps) {
  const scrollAreaRef = useRef<HTMLDivElement>(null);
  const lastRequestedConversationRef = useRef<string | null>(null);
  const [voiceComposerState, setVoiceComposerState] = useState<'idle' | 'recording' | 'review'>('idle');

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

  const isConversationSelected = Boolean(selectedConversationId);

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
        <div className="flex flex-col items-center justify-center gap-2 py-12 text-center text-slate-500">
          <p>Chưa chọn cuộc trò chuyện nào</p>
          <p className="text-sm">Hãy chọn một cuộc trò chuyện từ danh sách bên trái để bắt đầu.</p>
        </div>
      );
    }
    
    // Show loading only when actually loading messages
    if (loading && messages.length === 0) {
      return <p className="text-center text-sm text-slate-500">Đang tải tin nhắn...</p>;
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
        <div className="flex flex-col items-center justify-center gap-2 py-12 text-center text-slate-500">
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
          const isCurrentUser =
            currentUserName && message.sender?.toLowerCase() === currentUserName.toLowerCase();
          const timestamp = new Date(message.createdAt);
          const hasError = Boolean(message.error);

          return (
            <div
              key={message.id}
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
                      isCurrentUser ? 'self-end text-blue-200' : 'text-slate-600'
                    }`}
                  >
                    {isCurrentUser ? 'Bạn' : displayName}
                  </span>
                )}
                <div
                  className={`chat-bubble ${
                    isCurrentUser ? 'chat-bubble--outgoing' : 'chat-bubble--incoming'
                  } ${hasError ? 'border border-red-300 bg-red-50' : ''}`}
                >
                  {message.voiceRecording ? (
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
                        <p className="text-sm text-slate-500">Không thể phát tin nhắn thoại.</p>
                      )}
                      {message.voiceRecording.originalName && (
                        <p className="text-xs text-slate-500">
                          {message.voiceRecording.originalName}
                        </p>
                      )}
                      {message.content && (
                        <p className="text-xs text-slate-500">{message.content}</p>
                      )}
                    </div>
                  ) : (
                    <p className="whitespace-pre-line break-words">{message.content}</p>
                  )}
                  {hasError && (
                    <p className="mt-1 text-xs text-red-600">{message.error}</p>
                  )}
                </div>
                <span className="mt-1 text-xs text-slate-400">
                  {timestamp.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })}
                </span>
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
        <div className="flex flex-1 items-center gap-3">
          {isMobile && (
            <Button
              variant="ghost"
              size="icon"
              className="rounded-full sm:hidden"
              onClick={() => onOpenSidebar?.()}
              title="Mở danh sách cuộc trò chuyện"
              aria-label="Mở danh sách cuộc trò chuyện"
            >
              <Menu className="size-5 text-slate-600" />
            </Button>
          )}
          {isConversationSelected ? (
            <div className="flex items-center gap-3">
              <Avatar className="size-12">
                <AvatarFallback className="bg-blue-500 text-lg font-semibold text-white">
                  {conversationDisplay?.avatarFallback ??
                    getInitials(conversationDisplay?.title ?? 'Chat')}
                </AvatarFallback>
              </Avatar>
              <div>
                <h3 className="text-base font-semibold">
                  {conversationDisplay?.title ?? 'Cuộc trò chuyện'}
                </h3>
                <p className="text-sm text-slate-500">
                  {conversationDisplay?.subtitle ?? 'Đang hoạt động'}
                </p>
              </div>
            </div>
          ) : (
            <div>
              <h3 className="text-base font-semibold text-slate-900">Chưa chọn cuộc trò chuyện</h3>
              <p className="text-sm text-slate-500">
                Hãy chọn một cuộc trò chuyện từ danh sách để xem tin nhắn.
              </p>
            </div>
          )}
        </div>
        {isConversationSelected && (
          <div className="hidden items-center gap-2 sm:flex">
            <Button variant="ghost" size="icon" className="rounded-full">
              <Phone className="size-5 text-blue-500" />
            </Button>
            <Button variant="ghost" size="icon" className="rounded-full">
              <Video className="size-5 text-blue-500" />
            </Button>
            <Button variant="ghost" size="icon" className="rounded-full">
              <Info className="size-5 text-blue-500" />
            </Button>
          </div>
        )}
      </div>

      <ScrollArea ref={scrollAreaRef} className="chat-interface__messages h-full">
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 px-4 py-4">
          {renderBody()}
        </div>
      </ScrollArea>

      <div className="chat-interface__composer">
        <div className="mx-auto flex w-full max-w-3xl flex-wrap items-center gap-3 sm:flex-nowrap">
          {voiceComposerState === 'idle' && (
            <>
              <Input
                type="text"
                placeholder={isConversationSelected ? "Aa" : "Chọn cuộc trò chuyện để nhắn tin"}
                value={inputValue}
                onChange={(event) => onInputChange(event.target.value)}
                onKeyDown={handleKeyDown}
                disabled={sending || !isConversationSelected}
                className="flex-1 min-w-0 rounded-full bg-white"
              />
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
              <Button
                onClick={handleSubmit}
                size="icon"
                className="rounded-full"
                disabled={sending || !inputValue.trim() || !isConversationSelected}
              >
                <Send className="size-4" />
              </Button>
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
              <div className="flex flex-1 items-center justify-between rounded-full bg-slate-100 px-4 py-3 text-sm text-slate-600">
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
    </div>
  );
}
