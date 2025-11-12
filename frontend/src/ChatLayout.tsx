import { useMemo } from 'react';

import { ChatSidebar } from './ChatSidebar';
import { ChatInterface } from './ChatInterface';
import type { ChatMessage } from './chatTypes';

export interface ConversationPreview {
  id: string;
  title: string;
  subtitle?: string;
  lastMessageSnippet?: string;
  updatedAt?: string;
  unreadCount?: number;
  avatarFallback?: string;
  isGroup?: boolean;
}

export interface ChatLayoutProps {
  conversations: ConversationPreview[];
  selectedConversationId?: string | null;
  onSelectConversation: (id: string) => void;
  messages: ChatMessage[];
  loading: boolean;
  error: string | null;
  onRetry?: () => void;
  inputValue: string;
  onInputChange: (value: string) => void;
  onSend: () => void;
  sending: boolean;
  currentUserName?: string | null;
}

export function ChatLayout({
  conversations,
  selectedConversationId,
  onSelectConversation,
  messages,
  loading,
  error,
  onRetry,
  inputValue,
  onInputChange,
  onSend,
  sending,
  currentUserName,
}: ChatLayoutProps) {
  const activeConversation = useMemo(
    () => conversations.find((conversation) => conversation.id === selectedConversationId),
    [conversations, selectedConversationId],
  );

  return (
    <div className="chat-app">
      <ChatSidebar
        conversations={conversations}
        selectedConversationId={selectedConversationId ?? null}
        onSelectConversation={onSelectConversation}
      />
      <ChatInterface
        conversation={activeConversation}
        messages={messages}
        currentUserName={currentUserName}
        inputValue={inputValue}
        onInputChange={onInputChange}
        onSend={onSend}
        sending={sending}
        loading={loading}
        error={error}
        onRetry={onRetry}
      />
    </div>
  );
}

