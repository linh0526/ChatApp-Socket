import { useMemo } from 'react';

import { ChatSidebar } from './ChatSidebar';
import { ChatInterface } from './ChatInterface';
import type { ChatMessage } from './chatTypes';
import type {
  FriendActionFeedback,
  FriendRequestPreview,
  FriendRequestTarget,
  FriendSummary,
} from './friendTypes';

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
  messagesError?: string | null;
  onRetry?: () => void;
  inputValue: string;
  onInputChange: (value: string) => void;
  onSend: () => void;
  sending: boolean;
  currentUserName?: string | null;
  friends: FriendSummary[];
  incomingRequests: FriendRequestPreview[];
  outgoingRequests: FriendRequestPreview[];
  onStartConversationWithFriend: (friendId: string) => Promise<void>;
  onSendFriendRequest: (target: FriendRequestTarget) => Promise<void>;
  onAcceptFriendRequest: (requestId: string) => Promise<void>;
  onDeclineFriendRequest: (requestId: string) => Promise<void>;
  onCancelFriendRequest: (requestId: string) => Promise<void>;
  searchResults: FriendSummary[];
  onSearchUsers: (query: string) => Promise<void>;
  searchingUsers: boolean;
  friendFeedback: FriendActionFeedback | null;
  onClearFriendFeedback: () => void;
  friendActionPending: boolean;
  friendSearchError?: string | null;
  onCreateGroupConversation: (input: { name: string; memberIds: string[] }) => Promise<void>;
  onVoiceMessage?: () => void | Promise<void>;
  voiceMessagePending?: boolean;
  onVoiceMessageStop?: () => boolean | Promise<boolean>;
  onVoiceMessageSend?: () => void | Promise<void>;
  onVoiceMessageCancel?: () => void | Promise<void>;
  voiceRecordingReady?: boolean;
  onVideoCall?: () => void;
}

export function ChatLayout({
  conversations,
  selectedConversationId,
  onSelectConversation,
  messages,
  loading,
  onRetry,
  inputValue,
  onInputChange,
  onSend,
  sending,
  currentUserName,
  friends,
  incomingRequests,
  outgoingRequests,
  onStartConversationWithFriend,
  onSendFriendRequest,
  onAcceptFriendRequest,
  onDeclineFriendRequest,
  onCancelFriendRequest,
  searchResults,
  onSearchUsers,
  searchingUsers,
  friendFeedback,
  onClearFriendFeedback,
  friendActionPending,
  friendSearchError,
  messagesError,
  onCreateGroupConversation,
  onVoiceMessage,
  voiceMessagePending,
  onVoiceMessageStop,
  onVoiceMessageSend,
  onVoiceMessageCancel,
  voiceRecordingReady,
  onVideoCall,
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
        friends={friends}
        incomingRequests={incomingRequests}
        outgoingRequests={outgoingRequests}
        onStartConversation={onStartConversationWithFriend}
        onSendFriendRequest={onSendFriendRequest}
        onAcceptFriendRequest={onAcceptFriendRequest}
        onDeclineFriendRequest={onDeclineFriendRequest}
        onCancelFriendRequest={onCancelFriendRequest}
        searchResults={searchResults}
        onSearch={onSearchUsers}
        searching={searchingUsers}
        friendFeedback={friendFeedback}
        onClearFriendFeedback={onClearFriendFeedback}
        friendActionPending={friendActionPending}
        friendSearchError={friendSearchError}
        onCreateGroup={onCreateGroupConversation}
      />
      <ChatInterface
        conversation={activeConversation}
        selectedConversationId={selectedConversationId}
        messages={messages}
        messagesError={messagesError}
        currentUserName={currentUserName}
        inputValue={inputValue}
        onInputChange={onInputChange}
        onSend={onSend}
        sending={sending}
        loading={loading}
        onRetry={onRetry}
        onVoiceMessage={onVoiceMessage}
        voiceMessagePending={voiceMessagePending}
        onVoiceMessageStop={onVoiceMessageStop}
        onVoiceMessageSend={onVoiceMessageSend}
        onVoiceMessageCancel={onVoiceMessageCancel}
        voiceRecordingReady={voiceRecordingReady}
        onVideoCall={onVideoCall}
      />
    </div>
  );
}

