import { useEffect, useMemo, useRef } from 'react';
import type { KeyboardEvent } from 'react';
import { Info, Phone, Send, Video } from 'lucide-react';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Avatar, AvatarFallback } from './ui/avatar';
import { ScrollArea } from './ui/scroll-area';
import type { ConversationPreview } from './ChatLayout';
import type { ChatMessage } from './chatTypes';

interface ChatInterfaceProps {
  conversation?: ConversationPreview;
  messages: ChatMessage[];
  currentUserName?: string | null;
  inputValue: string;
  onInputChange: (value: string) => void;
  onSend: () => void;
  sending: boolean;
  loading: boolean;
  error: string | null;
  onRetry?: () => void;
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
  messages,
  currentUserName,
  inputValue,
  onInputChange,
  onSend,
  sending,
  loading,
  error,
  onRetry,
}: ChatInterfaceProps) {
  const scrollAreaRef = useRef<HTMLDivElement>(null);
  const lastRequestedConversationRef = useRef<string | null>(null);

  const conversationDisplay = useMemo(() => {
    if (conversation) return conversation;
    return {
      id: 'general',
      title: 'Phòng chung',
      subtitle: 'Trò chuyện với tất cả mọi người',
      avatarFallback: 'GC',
      isGroup: true,
    } satisfies ConversationPreview;
  }, [conversation]);

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
  }, [conversationDisplay.id]);

  useEffect(() => {
    if (!onRetry) return;
    if (loading) return;
    if (error) return;
    if (messages.length > 0) return;

    const convoId = conversationDisplay.id;
    if (lastRequestedConversationRef.current === convoId) return;
    lastRequestedConversationRef.current = convoId;
    onRetry();
  }, [messages.length, loading, error, onRetry, conversationDisplay.id]);

  const handleSubmit = () => {
    if (!inputValue.trim() || sending) return;
    onSend();
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      handleSubmit();
    }
  };

  const renderBody = () => {
    if (loading) {
      return <p className="text-center text-sm text-slate-500">Đang tải tin nhắn...</p>;
    }
    if (error) {
      return (
        <div className="flex flex-col items-center gap-2 rounded-xl bg-red-50 p-4 text-red-600">
          <p>{error}</p>
          {onRetry && (
            <Button variant="outline" size="sm" onClick={onRetry}>
              Thử lại
            </Button>
          )}
        </div>
      );
    }
    if (messages.length === 0) {
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
          const isCurrentUser =
            currentUserName && message.sender?.toLowerCase() === currentUserName.toLowerCase();
          const timestamp = new Date(message.createdAt);

          return (
            <div
              key={message.id}
              className={`flex gap-2 ${isCurrentUser ? 'flex-row-reverse' : 'flex-row'}`}
            >
              {!isCurrentUser && (
                <Avatar className="size-7 flex-shrink-0">
                  <AvatarFallback className="bg-blue-500 text-xs font-semibold text-white">
                    {conversationDisplay.avatarFallback ??
                      getInitials(conversationDisplay.title ?? message.sender)}
                  </AvatarFallback>
                </Avatar>
              )}

              <div
                className={`flex max-w-[60%] flex-col ${
                  isCurrentUser ? 'items-end text-right' : 'items-start'
                }`}
              >
                <div
                  className={`chat-bubble ${
                    isCurrentUser ? 'chat-bubble--outgoing' : 'chat-bubble--incoming'
                  }`}
                >
                  <p className="whitespace-pre-line">{message.content}</p>
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
        <div className="flex items-center gap-3">
          <Avatar className="size-12">
            <AvatarFallback className="bg-blue-500 text-lg font-semibold text-white">
              {conversationDisplay.avatarFallback ??
                getInitials(conversationDisplay.title ?? 'Chat')}
            </AvatarFallback>
          </Avatar>
          <div>
            <h3 className="text-base font-semibold">
              {conversationDisplay.title ?? 'Cuộc trò chuyện'}
            </h3>
            <p className="text-sm text-slate-500">
              {conversationDisplay.subtitle ?? 'Đang hoạt động'}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
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
      </div>

      <ScrollArea ref={scrollAreaRef} className="chat-interface__messages h-full">
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 px-4 py-4">
          {renderBody()}
        </div>
      </ScrollArea>

      <div className="chat-interface__composer">
        <div className="mx-auto flex w-full max-w-3xl gap-3">
          <Input
            type="text"
            placeholder="Aa"
            value={inputValue}
            onChange={(event) => onInputChange(event.target.value)}
            onKeyDown={handleKeyDown}
            disabled={sending}
            className="flex-1 rounded-full bg-white"
          />
          <Button
            onClick={handleSubmit}
            size="icon"
            className="rounded-full"
            disabled={sending || !inputValue.trim()}
          >
            <Send className="size-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}
