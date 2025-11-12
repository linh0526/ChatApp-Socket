import { useMemo, useState } from 'react';
import {
  Loader2,
  MessageSquarePlus,
  MoreHorizontal,
  Search,
  SquarePen,
  UserCheck,
  UserPlus,
  UserX,
} from 'lucide-react';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Popover, PopoverContent, PopoverTrigger } from './ui/popover';
import { Avatar, AvatarFallback } from './ui/avatar';
import type { ConversationPreview } from './ChatLayout';
import type {
  FriendActionFeedback,
  FriendRequestPreview,
  FriendRequestTarget,
  FriendSummary,
} from './friendTypes';

interface ChatSidebarProps {
  conversations: ConversationPreview[];
  selectedConversationId: string | null;
  onSelectConversation: (id: string) => void;
  friends: FriendSummary[];
  incomingRequests: FriendRequestPreview[];
  outgoingRequests: FriendRequestPreview[];
  onStartConversation: (friendId: string) => Promise<void>;
  onSendFriendRequest: (target: FriendRequestTarget) => Promise<void>;
  onAcceptFriendRequest: (requestId: string) => Promise<void>;
  onDeclineFriendRequest: (requestId: string) => Promise<void>;
  onCancelFriendRequest: (requestId: string) => Promise<void>;
  searchResults: FriendSummary[];
  onSearch: (query: string) => Promise<void>;
  searching: boolean;
  friendFeedback: FriendActionFeedback | null;
  onClearFriendFeedback: () => void;
  friendActionPending: boolean;
  friendSearchError?: string | null;
}

type FilterType = 'all' | 'unread' | 'groups';
type Section = 'conversations' | 'friends' | 'requests';

const formatTimestamp = (value?: string) => {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';

  const now = new Date();
  const isToday = date.toDateString() === now.toDateString();

  return isToday
    ? date.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })
    : date.toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit' });
};

const getInitials = (text: string) =>
  text
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0])
    .join('')
    .toUpperCase();

export function ChatSidebar({
  conversations,
  selectedConversationId,
  onSelectConversation,
  friends,
  incomingRequests,
  outgoingRequests,
  onStartConversation,
  onSendFriendRequest,
  onAcceptFriendRequest,
  onDeclineFriendRequest,
  onCancelFriendRequest,
  searchResults,
  onSearch,
  searching,
  friendFeedback,
  onClearFriendFeedback,
  friendActionPending,
  friendSearchError,
}: ChatSidebarProps) {
  const [conversationSearchQuery, setConversationSearchQuery] = useState('');
  const [filter, setFilter] = useState<FilterType>('all');
  const [activeSection, setActiveSection] = useState<Section>('conversations');
  const [friendSearchQuery, setFriendSearchQuery] = useState('');
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteError, setInviteError] = useState<string | null>(null);

  const filteredConversations = useMemo(() => {
    const query = conversationSearchQuery.trim().toLowerCase();

    return conversations.filter((conversation) => {
      const haystack = [
        conversation.title,
        conversation.subtitle,
        conversation.lastMessageSnippet,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      const matchesSearch = query.length === 0 || haystack.includes(query);

      if (!matchesSearch) return false;

      if (filter === 'unread') {
        return (conversation.unreadCount ?? 0) > 0;
      }
      if (filter === 'groups') {
        return Boolean(conversation.isGroup);
      }

      return true;
    });
  }, [conversations, filter, conversationSearchQuery]);

  const handleFriendSearchSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    await onSearch(friendSearchQuery);
  };

  const handleFriendSearchChange = (value: string) => {
    setFriendSearchQuery(value);
    if (value.trim().length === 0) {
      void onSearch('');
    }
  };

  const handleInviteSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmed = inviteEmail.trim();
    if (trimmed.length === 0) {
      setInviteError('Vui lòng nhập email');
      return;
    }
    const emailRegex =
      // eslint-disable-next-line no-useless-escape
      /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(trimmed)) {
      setInviteError('Email không hợp lệ');
      return;
    }
    setInviteError(null);
    try {
      await onSendFriendRequest({ email: trimmed });
      setInviteEmail('');
    } catch {
      // handled in parent via friendFeedback
    }
  };

  const sectionTitle =
    activeSection === 'conversations'
      ? 'Đoạn chat'
      : activeSection === 'friends'
        ? 'Bạn bè'
        : 'Lời mời kết bạn';

  const actionDisabled = friendActionPending;

  return (
    <div className="chat-sidebar">
      <div className="p-4">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-slate-900">{sectionTitle}</h2>
          {activeSection === 'conversations' && (
            <div className="flex items-center gap-2">
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="ghost" size="icon" className="size-9 rounded-full">
                    <MoreHorizontal className="size-5" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-56 p-2" align="end">
                  <div className="flex flex-col">
                    <button
                      type="button"
                      className="rounded-md px-3 py-2 text-left text-sm text-slate-600 transition hover:bg-slate-100"
                    >
                      Tin nhắn lưu trữ
                    </button>
                    <button
                      type="button"
                      className="rounded-md px-3 py-2 text-left text-sm text-slate-600 transition hover:bg-slate-100"
                    >
                      Tuỳ chọn
                    </button>
                  </div>
                </PopoverContent>
              </Popover>
              <Button variant="ghost" size="icon" className="size-9 rounded-full">
                <SquarePen className="size-5" />
              </Button>
            </div>
          )}
        </div>

        <div className="flex gap-2">
          {([
            { key: 'conversations', label: 'Chat' },
            { key: 'friends', label: 'Bạn bè' },
            { key: 'requests', label: 'Lời mời' },
          ] as const).map((item) => {
            const isActive = activeSection === item.key;
            return (
              <button
                key={item.key}
                type="button"
                onClick={() => setActiveSection(item.key)}
                className={`rounded-full px-4 py-1.5 text-sm font-medium transition ${
                  isActive
                    ? 'bg-blue-500 text-white shadow'
                    : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                }`}
              >
                {item.label}
              </button>
            );
          })}
        </div>

        {friendFeedback && (
          <div
            className={`mt-4 flex items-start justify-between rounded-lg border px-3 py-2 text-sm ${
              friendFeedback.type === 'success'
                ? 'border-green-200 bg-green-50 text-green-700'
                : 'border-red-200 bg-red-50 text-red-700'
            }`}
          >
            <span>{friendFeedback.message}</span>
            <button
              type="button"
              onClick={onClearFriendFeedback}
              className="ml-3 text-xs font-semibold uppercase tracking-wide text-inherit transition hover:opacity-75"
            >
              Đóng
            </button>
          </div>
        )}

        {activeSection === 'conversations' && (
          <>
            <div className="mt-4 flex justify-center">
              <div className="relative w-full">
                <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
                <Input
                  type="text"
                  placeholder="Tìm kiếm trên chat"
                  value={conversationSearchQuery}
                  onChange={(event) => setConversationSearchQuery(event.target.value)}
                  className="w-full rounded-full border-0 bg-slate-100 pl-10 text-sm focus-visible:ring-0"
                />
              </div>
            </div>

            <div className="mt-4 flex gap-2">
              {([
                { key: 'all', label: 'Tất cả' },
                { key: 'unread', label: 'Chưa đọc' },
                { key: 'groups', label: 'Nhóm' },
              ] as const).map((item) => {
                const isActive = filter === item.key;
                return (
                  <button
                    key={item.key}
                    type="button"
                    onClick={() => setFilter(item.key)}
                    className={`rounded-full px-4 py-1.5 text-sm font-medium transition ${
                      isActive
                        ? 'bg-blue-500 text-white shadow'
                        : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                    }`}
                  >
                    {item.label}
                  </button>
                );
              })}
            </div>
          </>
        )}

        {activeSection === 'friends' && (
          <form className="mt-4 flex gap-2" onSubmit={handleFriendSearchSubmit}>
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
              <Input
                type="text"
                placeholder="Tìm kiếm bạn bè theo tên hoặc email"
                value={friendSearchQuery}
                onChange={(event) => handleFriendSearchChange(event.target.value)}
                className="w-full rounded-full border-0 bg-slate-100 pl-10 text-sm focus-visible:ring-0"
              />
            </div>
            <Button type="submit" className="rounded-full" disabled={searching}>
              {searching ? <Loader2 className="size-4 animate-spin" /> : <UserPlus className="size-4" />}
            </Button>
          </form>
        )}
      </div>

      <div className="chat-sidebar__list flex-1 overflow-y-auto">
        {activeSection === 'conversations' && (
          <>
            {filteredConversations.length === 0 ? (
              <div className="px-6 py-8 text-center text-sm text-slate-500">
                Không tìm thấy cuộc trò chuyện phù hợp
              </div>
            ) : (
              filteredConversations.map((conversation) => {
                const isSelected = selectedConversationId === conversation.id;
                return (
                  <button
                    key={conversation.id}
                    type="button"
                    onClick={() => onSelectConversation(conversation.id)}
                    className={`flex w-full items-center gap-3 px-4 py-3 text-left transition ${
                      isSelected ? 'bg-slate-100' : 'hover:bg-slate-50'
                    }`}
                  >
                    <Avatar className="size-12">
                      <AvatarFallback className="bg-blue-500 text-base font-semibold text-white">
                        {conversation.avatarFallback ?? getInitials(conversation.title)}
                      </AvatarFallback>
                    </Avatar>
                    <div className="min-w-0 flex-1">
                      <div className="mb-1 flex items-center justify-between gap-2">
                        <span
                          className={`truncate text-sm font-medium ${
                            isSelected ? 'text-blue-600' : 'text-slate-900'
                          }`}
                        >
                          {conversation.title}
                        </span>
                        <span className="text-xs text-slate-400">
                          {formatTimestamp(conversation.updatedAt)}
                        </span>
                      </div>
                      <p
                        className={`truncate text-xs ${
                          (conversation.unreadCount ?? 0) > 0
                            ? 'font-medium text-slate-900'
                            : 'text-slate-500'
                        }`}
                      >
                        {conversation.lastMessageSnippet ||
                          conversation.subtitle ||
                          'Chưa có tin nhắn'}
                      </p>
                    </div>
                    {(conversation.unreadCount ?? 0) > 0 && (
                      <span className="flex size-6 items-center justify-center rounded-full bg-blue-500 text-xs font-semibold text-white">
                        {conversation.unreadCount}
                      </span>
                    )}
                  </button>
                );
              })
            )}
          </>
        )}

        {activeSection === 'friends' && (
          <div className="flex h-full flex-col gap-4 px-4 py-4">
            {friendSearchError && (
              <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                {friendSearchError}
              </div>
            )}

            <form onSubmit={handleInviteSubmit} className="space-y-2 rounded-lg border border-slate-200 bg-white px-4 py-4">
              <div>
                <h3 className="text-sm font-semibold text-slate-900">Thêm bạn bằng email</h3>
                <p className="text-xs text-slate-500">Nhập địa chỉ email chính xác để gửi lời mời.</p>
              </div>
              <div className="flex gap-2">
                <Input
                  type="email"
                  placeholder="vd: banbe@example.com"
                  value={inviteEmail}
                  onChange={(event) => setInviteEmail(event.target.value)}
                  className="flex-1"
                  disabled={friendActionPending}
                />
                <Button
                  type="submit"
                  className="rounded-full"
                  disabled={friendActionPending || inviteEmail.trim().length === 0}
                >
                  {friendActionPending ? <Loader2 className="size-4 animate-spin" /> : <UserPlus className="size-4" />}
                </Button>
              </div>
              {inviteError && <p className="text-xs text-red-500">{inviteError}</p>}
            </form>

            {friendSearchQuery.trim().length > 0 && (
              <div>
                <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Kết quả tìm kiếm
                </h3>
                {searching ? (
                  <div className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-4 py-3 text-sm text-slate-500">
                    <Loader2 className="size-4 animate-spin text-blue-500" />
                    Đang tìm kiếm...
                  </div>
                ) : searchResults.length === 0 ? (
                  <div className="rounded-lg border border-dashed border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-500">
                    Không tìm thấy người dùng phù hợp
                  </div>
                ) : (
                  <div className="space-y-3">
                    {searchResults.map((user) => (
                      <div
                        key={user.id}
                        className="flex items-center justify-between rounded-lg border border-slate-200 bg-white px-4 py-3"
                      >
                        <div>
                          <p className="text-sm font-medium text-slate-900">{user.username}</p>
                          <p className="text-xs text-slate-500">{user.email}</p>
                        </div>
                        <Button
                          type="button"
                          size="sm"
                          className="rounded-full"
                          onClick={() => onSendFriendRequest({ userId: user.id })}
                          disabled={actionDisabled}
                        >
                          <UserPlus className="mr-2 size-4" />
                          Kết bạn
                        </Button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            <div>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
                Bạn bè
              </h3>
              {friends.length === 0 ? (
                <div className="rounded-lg border border-dashed border-slate-200 bg-slate-50 px-4 py-4 text-center text-sm text-slate-500">
                  Bạn chưa có bạn bè nào. Hãy tìm và kết bạn để trò chuyện riêng tư.
                </div>
              ) : (
                <div className="space-y-3">
                  {friends.map((friend) => (
                    <div
                      key={friend.id}
                      className="flex items-center justify-between rounded-lg border border-slate-200 bg-white px-4 py-3"
                    >
                      <div>
                        <p className="text-sm font-medium text-slate-900">{friend.username}</p>
                        <p className="text-xs text-slate-500">{friend.email}</p>
                      </div>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="rounded-full"
                        onClick={() => onStartConversation(friend.id)}
                        disabled={actionDisabled}
                      >
                        <MessageSquarePlus className="mr-2 size-4" />
                        Nhắn tin
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {activeSection === 'requests' && (
          <div className="flex h-full flex-col gap-4 px-4 py-4">
            <div>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
                Lời mời đến
              </h3>
              {incomingRequests.length === 0 ? (
                <div className="rounded-lg border border-dashed border-slate-200 bg-slate-50 px-4 py-4 text-center text-sm text-slate-500">
                  Bạn chưa có lời mời kết bạn nào.
                </div>
              ) : (
                <div className="space-y-3">
                  {incomingRequests.map((request) => (
                    <div
                      key={request.id}
                      className="flex items-center justify-between rounded-lg border border-slate-200 bg-white px-4 py-3"
                    >
                      <div>
                        <p className="text-sm font-medium text-slate-900">{request.user.username}</p>
                        <p className="text-xs text-slate-500">{request.user.email}</p>
                      </div>
                      <div className="flex items-center gap-2">
                        <Button
                          type="button"
                          size="sm"
                          className="rounded-full"
                          onClick={() => onAcceptFriendRequest(request.id)}
                          disabled={actionDisabled}
                        >
                          <UserCheck className="mr-2 size-4" />
                          Chấp nhận
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          className="rounded-full"
                          onClick={() => onDeclineFriendRequest(request.id)}
                          disabled={actionDisabled}
                        >
                          <UserX className="mr-2 size-4" />
                          Từ chối
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
                Đã gửi
              </h3>
              {outgoingRequests.length === 0 ? (
                <div className="rounded-lg border border-dashed border-slate-200 bg-slate-50 px-4 py-4 text-center text-sm text-slate-500">
                  Bạn chưa gửi lời mời nào.
                </div>
              ) : (
                <div className="space-y-3">
                  {outgoingRequests.map((request) => (
                    <div
                      key={request.id}
                      className="flex items-center justify-between rounded-lg border border-slate-200 bg-white px-4 py-3"
                    >
                      <div>
                        <p className="text-sm font-medium text-slate-900">{request.user.username}</p>
                        <p className="text-xs text-slate-500">{request.user.email}</p>
                      </div>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        className="rounded-full"
                        onClick={() => onCancelFriendRequest(request.id)}
                        disabled={actionDisabled}
                      >
                        <UserX className="mr-2 size-4" />
                        Huỷ
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
