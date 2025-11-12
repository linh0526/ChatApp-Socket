import { useEffect, useMemo, useState } from 'react';
import {
  Check,
  Loader2,
  MessageSquarePlus,
  MoreHorizontal,
  Search,
  SquarePen,
  X,
  UserCheck,
  UserPlus,
  UserX,
} from 'lucide-react';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Popover, PopoverContent, PopoverTrigger } from './ui/popover';
import { Avatar, AvatarFallback } from './ui/avatar';
import { ScrollArea } from './ui/scroll-area';
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
  onCreateGroup: (input: { name: string; memberIds: string[] }) => Promise<void>;
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
  onCreateGroup,
}: ChatSidebarProps) {
  const [conversationSearchQuery, setConversationSearchQuery] = useState('');
  const [filter, setFilter] = useState<FilterType>('all');
  const [activeSection, setActiveSection] = useState<Section>('conversations');
  const [friendSearchQuery, setFriendSearchQuery] = useState('');
  const [newChatOpen, setNewChatOpen] = useState(false);
  const [createGroupOpen, setCreateGroupOpen] = useState(false);
  const [groupSearchQuery, setGroupSearchQuery] = useState('');
  const [groupName, setGroupName] = useState('');
  const [selectedGroupMemberIds, setSelectedGroupMemberIds] = useState<string[]>([]);
  const [groupCreateError, setGroupCreateError] = useState<string | null>(null);
  const [creatingGroup, setCreatingGroup] = useState(false);

  useEffect(() => {
    if (!createGroupOpen) {
      setGroupName('');
      setGroupSearchQuery('');
      setSelectedGroupMemberIds([]);
      setGroupCreateError(null);
      setCreatingGroup(false);
    }
  }, [createGroupOpen]);

  useEffect(() => {
    setSelectedGroupMemberIds((prev) =>
      prev.filter((id) => friends.some((friend) => friend.id === id)),
    );
  }, [friends]);

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

  const filteredGroupFriends = useMemo(() => {
    const query = groupSearchQuery.trim().toLowerCase();
    const base = query.length
      ? friends.filter((friend) => {
          const haystack = [friend.username, friend.email].filter(Boolean).join(' ').toLowerCase();
          return haystack.includes(query);
        })
      : friends;
    return [...base].sort((a, b) => {
      const nameA = a.username ?? '';
      const nameB = b.username ?? '';
      return nameA.localeCompare(nameB);
    });
  }, [friends, groupSearchQuery]);

  const groupedFriends = useMemo(() => {
    return filteredGroupFriends.reduce<Record<string, FriendSummary[]>>((acc, friend) => {
      const initial = friend.username?.[0]?.toUpperCase() ?? '#';
      if (!acc[initial]) {
        acc[initial] = [];
      }
      acc[initial].push(friend);
      return acc;
    }, {});
  }, [filteredGroupFriends]);

  const groupedFriendEntries = useMemo(
    () => Object.entries(groupedFriends).sort(([a], [b]) => a.localeCompare(b)),
    [groupedFriends],
  );

  const recentConversationPreviews = useMemo(() => {
    const query = groupSearchQuery.trim().toLowerCase();
    const source =
      query.length > 0
        ? filteredConversations.filter((conversation) => {
            const haystack = [
              conversation.title,
              conversation.subtitle,
              conversation.lastMessageSnippet,
            ]
              .filter(Boolean)
              .join(' ')
              .toLowerCase();
            return haystack.includes(query);
          })
        : filteredConversations;
    return source.slice(0, 6);
  }, [filteredConversations, groupSearchQuery]);

  const toggleGroupMember = (friendId: string) => {
    setSelectedGroupMemberIds((prev) =>
      prev.includes(friendId) ? prev.filter((id) => id !== friendId) : [...prev, friendId],
    );
  };

  const closeGroupModal = () => {
    setCreateGroupOpen(false);
  };

  const handleCreateGroup = async () => {
    const trimmedName = groupName.trim();
    if (trimmedName.length === 0) {
      setGroupCreateError('Vui lòng nhập tên nhóm');
      return;
    }
    if (selectedGroupMemberIds.length < 2) {
      setGroupCreateError('Vui lòng chọn ít nhất 2 thành viên');
      return;
    }
    setCreatingGroup(true);
    setGroupCreateError(null);
    try {
      await onCreateGroup({ name: trimmedName, memberIds: selectedGroupMemberIds });
      closeGroupModal();
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Không thể tạo nhóm trò chuyện';
      setGroupCreateError(message);
    } finally {
      setCreatingGroup(false);
    }
  };

  const selectedGroupCount = selectedGroupMemberIds.length;
  const canSubmitGroup =
    groupName.trim().length > 0 && selectedGroupMemberIds.length >= 2 && !creatingGroup;

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
                <PopoverContent className="w-56 p-2 bg-white" align="end">
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
              <Popover open={newChatOpen} onOpenChange={setNewChatOpen}>
                <PopoverTrigger asChild>
                  <Button variant="ghost" size="icon" className="size-9 rounded-full">
                    <SquarePen className="size-5" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="flex h-[22rem] w-80 flex-col bg-white p-0" align="end">
                  <div className="border-b border-gray-200 p-3">
                    <Button
                      type="button"
                      variant="ghost"
                      className="w-full justify-start px-0 text-left text-sm font-medium text-blue-600 hover:bg-transparent hover:text-blue-700"
                      onClick={() => {
                        setNewChatOpen(false);
                        setCreateGroupOpen(true);
                      }}
                    >
                      Tạo nhóm chat
                    </Button>
                  </div>

                  <div className="flex flex-1 flex-col overflow-hidden">
                    <div className="px-3 py-2">
                      <h3 className="text-sm">Danh bạ của bạn</h3>
                    </div>
                    <ScrollArea className="flex-1">
                      <div className="px-2 pb-2">
                        {friends.length === 0 ? (
                          <div className="rounded-lg border border-dashed border-slate-200 bg-slate-50 px-4 py-6 text-center text-sm text-slate-500">
                            Bạn chưa có bạn bè nào để bắt đầu cuộc trò chuyện mới.
                          </div>
                        ) : (
                          friends.map((friend) => (
                            <button
                              key={friend.id}
                              type="button"
                              onClick={async () => {
                                setNewChatOpen(false);
                                try {
                                  await onStartConversation(friend.id);
                                } catch {
                                  // handled upstream
                                }
                              }}
                              disabled={actionDisabled}
                              className="flex w-full items-center gap-3 rounded-lg p-2 transition-colors hover:bg-gray-100"
                            >
                              <Avatar className="size-10">
                                <AvatarFallback className="bg-blue-500 text-white">
                                  {friend.username ? getInitials(friend.username) : '?'}
                                </AvatarFallback>
                              </Avatar>
                              <div className="flex-1 text-left">
                                <p className="text-sm text-slate-900">{friend.username}</p>
                                {friend.email && (
                                  <p className="text-xs text-slate-500">{friend.email}</p>
                                )}
                              </div>
                            </button>
                          ))
                        )}
                      </div>
                    </ScrollArea>
                  </div>
                </PopoverContent>
              </Popover>
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

      {createGroupOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          onClick={closeGroupModal}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="create-group-title"
            className="relative flex h-[800px] w-[600px] max-w-[90vw] flex-col overflow-hidden rounded-xl bg-white shadow-2xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-center justify-between gap-3 border-b border-slate-200 px-6 py-4">
              <h2 id="create-group-title" className="text-left text-[18px] font-semibold text-slate-900">
                Tạo nhóm
              </h2>
              <button
                type="button"
                onClick={closeGroupModal}
                className="rounded-full p-1.5 text-slate-400 transition hover:bg-slate-100 hover:text-slate-600"
              >
                <X className="size-4" />
                <span className="sr-only">Đóng</span>
              </button>
            </div>

            <div className="px-6 pb-4 pt-3">
              <div className="flex items-center gap-3">
                <Avatar className="size-8">
                  <AvatarFallback className="bg-blue-500 text-white">G</AvatarFallback>
                </Avatar>
                <Input
                  type="text"
                  value={groupName}
                  onChange={(event) => setGroupName(event.target.value)}
                  placeholder="Nhập tên nhóm"
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus-visible:ring-1 focus-visible:ring-blue-500"
                />
              </div>
              <div className="mt-4">
                <Input
                  type="text"
                  value={groupSearchQuery}
                  onChange={(event) => setGroupSearchQuery(event.target.value)}
                  placeholder="Nhập tên người dùng"
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus-visible:ring-1 focus-visible:ring-blue-500"
                />
              </div>
            </div>

            <div className="flex-1 overflow-hidden px-6">
              <div className="pb-2">
                <h3 className="text-sm font-medium text-slate-700">Trò chuyện gần đây</h3>
              </div>
              <div className="space-y-2">
                {recentConversationPreviews.length === 0 ? (
                  <p className="text-sm text-slate-500">Chưa có cuộc trò chuyện phù hợp.</p>
                ) : (
                  recentConversationPreviews.map((conversation) => (
                    <button
                      key={conversation.id}
                      type="button"
                      className="flex w-full items-center justify-between rounded-lg border border-slate-200 px-3 py-2 text-left text-sm transition hover:border-blue-200 hover:bg-blue-50"
                    >
                      <span className="truncate font-medium text-slate-900">
                        {conversation.title}
                      </span>
                      {conversation.updatedAt && (
                        <span className="text-xs text-slate-400">
                          {formatTimestamp(conversation.updatedAt)}
                        </span>
                      )}
                    </button>
                  ))
                )}
              </div>

              <div className="mt-6 flex-1 overflow-hidden">
                <h3 className="mb-3 text-sm font-medium text-slate-700">Danh bạ</h3>
              <div className="mb-2 flex items-center justify-between text-xs">
                <span className="text-slate-500">Đã chọn {selectedGroupCount} thành viên</span>
                <span
                  className={`font-medium ${
                    selectedGroupCount < 2 ? 'text-red-500' : 'text-green-600'
                  }`}
                >
                  {selectedGroupCount < 2 ? 'Chọn ít nhất 2 thành viên' : 'Đủ điều kiện'}
                </span>
              </div>
                <ScrollArea className="h-full">
                  <div className="space-y-4 pb-4">
                    {groupedFriendEntries.length === 0 ? (
                      <p className="text-sm text-slate-500">
                        {friends.length === 0
                          ? 'Bạn chưa có bạn bè trong danh sách.'
                          : 'Không tìm thấy bạn bè phù hợp với tìm kiếm.'}
                      </p>
                    ) : (
                      groupedFriendEntries.map(([letter, items]) => (
                        <div key={letter} className="space-y-2">
                          <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                            {letter}
                          </p>
                          <div className="space-y-2">
                          {items.map((friend) => {
                            const isSelected = selectedGroupMemberIds.includes(friend.id);
                            return (
                              <button
                                key={friend.id}
                                type="button"
                                onClick={() => {
                                  if (creatingGroup) return;
                                  toggleGroupMember(friend.id);
                                }}
                                disabled={creatingGroup}
                                className={`group flex w-full items-center justify-between gap-3 rounded-lg border px-3 py-2 text-left transition ${
                                  isSelected
                                    ? 'border-blue-500 bg-blue-50 shadow-sm'
                                    : 'border-slate-200 hover:border-blue-200 hover:bg-blue-50'
                                } ${creatingGroup ? 'cursor-not-allowed opacity-60' : ''}`}
                              >
                                <div className="flex items-center gap-3">
                                  <Avatar className="size-8">
                                    <AvatarFallback className="bg-blue-500 text-sm font-semibold text-white">
                                      {friend.username ? getInitials(friend.username) : '?'}
                                    </AvatarFallback>
                                  </Avatar>
                                  <div className="flex-1">
                                    <p className="text-sm font-medium text-slate-900">
                                      {friend.username}
                                    </p>
                                    {friend.email && (
                                      <p className="text-xs text-slate-500">{friend.email}</p>
                                    )}
                                  </div>
                                </div>
                                <span
                                  className={`flex size-5 items-center justify-center rounded-full border transition ${
                                    isSelected
                                      ? 'border-blue-500 bg-blue-500 text-white'
                                      : 'border-slate-300 text-slate-400 opacity-0 group-hover:opacity-100'
                                  }`}
                                >
                                  <Check className="size-3" />
                                </span>
                              </button>
                            );
                          })}
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </ScrollArea>
              </div>
            </div>

          {groupCreateError && (
            <div className="px-6 pt-2">
              <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-600">
                {groupCreateError}
              </div>
            </div>
          )}

            <div className="flex items-center justify-end gap-2 border-t border-slate-200 px-6 py-4">
              <Button
                type="button"
                variant="outline"
                onClick={closeGroupModal}
                className="min-w-24"
              >
                Huỷ
              </Button>
              <Button
                type="button"
                className="min-w-28"
                onClick={handleCreateGroup}
                disabled={!canSubmitGroup}
              >
                {creatingGroup ? (
                  <span className="flex items-center gap-2">
                    <Loader2 className="size-4 animate-spin" />
                    Đang tạo...
                  </span>
                ) : (
                  'Tạo nhóm'
                )}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
