import { useEffect, useMemo, useState } from 'react';

import { ChatSidebar } from './ChatSidebar';
import { ChatInterface } from './ChatInterface';
import type { ChatMessage } from './chatTypes';
import type {
  FriendActionFeedback,
  FriendRequestPreview,
  FriendRequestTarget,
  FriendSummary,
} from './friendTypes';
import { Sheet, SheetContent } from './ui/sheet';
import { useIsMobile } from './ui/legacy/use-mobile';

export interface ConversationPreview {
  id: string;
  title: string;
  subtitle?: string;
  lastMessageSnippet?: string;
  updatedAt?: string;
  unreadCount?: number;
  avatarFallback?: string;
  isGroup?: boolean;
  isArchived?: boolean;
  archivedAt?: string | null;
  participants?: Array<{
    id: string;
    username: string;
    email?: string;
    avatarUrl?: string | null;
  }>;
}

export interface ChatLayoutProps {
  conversations: ConversationPreview[];
  archivedConversations: ConversationPreview[];
  selectedConversationId?: string | null;
  onSelectConversation: (id: string) => void;
  onArchiveConversation: (conversationId: string) => Promise<void>;
  onUnarchiveConversation: (conversationId: string) => Promise<void>;
  onRefreshArchived: () => Promise<void>;
  messages: ChatMessage[];
  loading: boolean;
  messagesError?: string | null;
  onRetry?: () => void;
  inputValue: string;
  onInputChange: (value: string) => void;
  onSend: () => void;
  sending: boolean;
  currentUserName?: string | null;
  currentUserId?: string | null;
  friends: FriendSummary[];
  incomingRequests: FriendRequestPreview[];
  outgoingRequests: FriendRequestPreview[];
  onStartConversationWithFriend: (friendId: string) => Promise<void>;
  onSendFriendRequest: (target: FriendRequestTarget) => Promise<void>;
  onAcceptFriendRequest: (requestId: string) => Promise<void>;
  onDeclineFriendRequest: (requestId: string) => Promise<void>;
  onCancelFriendRequest: (requestId: string) => Promise<void>;
  onRemoveFriend: (friendId: string) => Promise<void>;
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
  onSendImage?: (file: File) => void | Promise<void>;
  onSendFile?: (file: File) => void | Promise<void>;
  onRecallMessage?: (messageId: string) => Promise<void>;
  onSearchMessages?: (conversationId: string, query: string) => Promise<ChatMessage[]>;
  onDeleteConversation?: (conversationId: string) => Promise<void>;
  onLeaveConversation?: (
    conversationId: string,
    options?: { mode?: 'silent' | 'block' },
  ) => Promise<void>;
}

export function ChatLayout({
  conversations,
  archivedConversations,
  selectedConversationId,
  onSelectConversation,
  onArchiveConversation,
  onUnarchiveConversation,
  onRefreshArchived,
  messages,
  loading,
  onRetry,
  inputValue,
  onInputChange,
  onSend,
  sending,
  currentUserName,
  currentUserId,
  friends,
  incomingRequests,
  outgoingRequests,
  onStartConversationWithFriend,
  onSendFriendRequest,
  onAcceptFriendRequest,
  onDeclineFriendRequest,
  onCancelFriendRequest,
  onRemoveFriend,
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
  onSendImage,
  onSendFile,
  onRecallMessage,
  onSearchMessages,
  onDeleteConversation,
  onLeaveConversation,
}: ChatLayoutProps) {
  const isMobile = useIsMobile();
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);

  useEffect(() => {
    if (!isMobile) {
      setMobileSidebarOpen(false);
      return;
    }
    if (!selectedConversationId && conversations.length > 0) {
      setMobileSidebarOpen(true);
    }
  }, [isMobile, selectedConversationId, conversations.length]);

  const activeConversation = useMemo(
    () =>
      conversations.find((conversation) => conversation.id === selectedConversationId) ??
      archivedConversations.find((conversation) => conversation.id === selectedConversationId),
    [archivedConversations, conversations, selectedConversationId],
  );

  const handleSelectConversation = (id: string) => {
    onSelectConversation(id);
    if (isMobile) {
      setMobileSidebarOpen(false);
    }
  };

  const sidebar = (
    <ChatSidebar
      conversations={conversations}
      archivedConversations={archivedConversations}
      selectedConversationId={selectedConversationId ?? null}
      onSelectConversation={handleSelectConversation}
      onArchiveConversation={onArchiveConversation}
      onUnarchiveConversation={onUnarchiveConversation}
      onRefreshArchived={onRefreshArchived}
      friends={friends}
      incomingRequests={incomingRequests}
      outgoingRequests={outgoingRequests}
      onStartConversation={onStartConversationWithFriend}
      onSendFriendRequest={onSendFriendRequest}
      onAcceptFriendRequest={onAcceptFriendRequest}
      onDeclineFriendRequest={onDeclineFriendRequest}
      onCancelFriendRequest={onCancelFriendRequest}
      onRemoveFriend={onRemoveFriend}
      searchResults={searchResults}
      onSearch={onSearchUsers}
      searching={searchingUsers}
      friendFeedback={friendFeedback}
      onClearFriendFeedback={onClearFriendFeedback}
      friendActionPending={friendActionPending}
      friendSearchError={friendSearchError}
      onCreateGroup={onCreateGroupConversation}
    />
  );

  return (
    <div className="chat-app">
      {isMobile ? (
        <>
          <Sheet open={mobileSidebarOpen} onOpenChange={setMobileSidebarOpen}>
            <SheetContent side="left" className="p-0 w-full max-w-full border-none sm:max-w-sm sm:border-r">
              <div className="flex h-full w-full overflow-hidden">
                {sidebar}
              </div>
            </SheetContent>
          </Sheet>
          <ChatInterface
            conversation={activeConversation}
            selectedConversationId={selectedConversationId}
            messages={messages}
            messagesError={messagesError}
            currentUserName={currentUserName}
            currentUserId={currentUserId}
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
            onArchiveConversation={onArchiveConversation}
            onUnarchiveConversation={onUnarchiveConversation}
            onRecallMessage={onRecallMessage}
            onSearchMessages={onSearchMessages}
            onDeleteConversation={onDeleteConversation}
            onLeaveConversation={onLeaveConversation}
            isMobile
            onOpenSidebar={() => setMobileSidebarOpen(true)}
            onSendImage={onSendImage}
            onSendFile={onSendFile}
            friends={friends}
          />
        </>
      ) : (
        <>
          {sidebar}
          <ChatInterface
            conversation={activeConversation}
            selectedConversationId={selectedConversationId}
            messages={messages}
            messagesError={messagesError}
            currentUserName={currentUserName}
            currentUserId={currentUserId}
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
            onSendImage={onSendImage}
            onSendFile={onSendFile}
            onArchiveConversation={onArchiveConversation}
            onUnarchiveConversation={onUnarchiveConversation}
            onRecallMessage={onRecallMessage}
            onSearchMessages={onSearchMessages}
            onDeleteConversation={onDeleteConversation}
            onLeaveConversation={onLeaveConversation}
            friends={friends}
          />
        </>
      )}
    </div>
  );
}

