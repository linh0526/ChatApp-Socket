import { useEffect, useMemo, useState } from 'react';
import {
  Archive,
  ArchiveRestore,
  Check,
  ChevronDown,
  Loader2,
  MessageSquarePlus,
  MoreHorizontal,
  Search,
  SquarePen,
  Moon,
  Sun,
  X,
  UserCheck,
  UserMinus,
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
  archivedConversations: ConversationPreview[];
  selectedConversationId: string | null;
  onSelectConversation: (id: string) => void;
  onArchiveConversation: (id: string) => Promise<void>;
  onUnarchiveConversation: (id: string) => Promise<void>;
  onRefreshArchived: () => Promise<void>;
  friends: FriendSummary[];
  incomingRequests: FriendRequestPreview[];
  outgoingRequests: FriendRequestPreview[];
  onStartConversation: (friendId: string) => Promise<void>;
  onRemoveFriend: (friendId: string) => Promise<void>;
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
const THEME_STORAGE_KEY = 'chatapp-theme-preference';

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
  archivedConversations,
  selectedConversationId,
  onSelectConversation,
  onArchiveConversation,
  onUnarchiveConversation,
  onRefreshArchived,
  friends,
  incomingRequests,
  outgoingRequests,
  onStartConversation,
  onRemoveFriend,
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
  const [isDarkMode, setIsDarkMode] = useState(false);
  const [optionsExpanded, setOptionsExpanded] = useState(false);
  const [archivingConversationId, setArchivingConversationId] = useState<string | null>(null);
  const [archivedOpen, setArchivedOpen] = useState(false);
  const [archivedLoading, setArchivedLoading] = useState(false);
  const [archivedError, setArchivedError] = useState<string | null>(null);
  const [archivedActionId, setArchivedActionId] = useState<string | null>(null);
  const [removingFriendId, setRemovingFriendId] = useState<string | null>(null);

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

  useEffect(() => {
    if (typeof window === 'undefined' || typeof document === 'undefined') {
      return;
    }
    const storedTheme = window.localStorage.getItem(THEME_STORAGE_KEY);
    const prefersDark = window.matchMedia?.('(prefers-color-scheme: dark)').matches;
    const initialDark = storedTheme === 'dark' || (storedTheme === null && prefersDark);
    setIsDarkMode(initialDark);
    document.documentElement.classList.toggle('dark', initialDark);
  }, []);

  const applyThemePreference = (dark: boolean) => {
    setIsDarkMode(dark);
    if (typeof document !== 'undefined') {
      document.documentElement.classList.toggle('dark', dark);
    }
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(THEME_STORAGE_KEY, dark ? 'dark' : 'light');
    }
  };

  const handleToggleDarkMode = () => {
    applyThemePreference(!isDarkMode);
  };

  const handleArchiveConversationClick = async (conversationId: string) => {
    setArchivingConversationId(conversationId);
    try {
      await onArchiveConversation(conversationId);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Không thể lưu trữ cuộc trò chuyện';
      window.alert(message);
    } finally {
      setArchivingConversationId(null);
    }
  };

  const handleOpenArchived = async () => {
    setArchivedError(null);
    setArchivedOpen(true);
    setArchivedLoading(true);
    try {
      await onRefreshArchived();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Không thể tải tin nhắn lưu trữ';
      setArchivedError(message);
    } finally {
      setArchivedLoading(false);
    }
  };

  const handleCloseArchived = () => {
    if (archivedActionId) {
      return;
    }
    setArchivedOpen(false);
    setArchivedError(null);
  };

  const handleRestoreConversation = async (conversationId: string, openAfter: boolean) => {
    setArchivedActionId(conversationId);
    setArchivedError(null);
    try {
      await onUnarchiveConversation(conversationId);
      await onRefreshArchived();
      if (openAfter) {
        setArchivedOpen(false);
        onSelectConversation(conversationId);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Không thể bỏ lưu trữ cuộc trò chuyện';
      setArchivedError(message);
    } finally {
      setArchivedActionId(null);
    }
  };

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

  const handleRemoveFriend = async (friend: FriendSummary) => {
    if (!onRemoveFriend || actionDisabled) {
      return;
    }
    const confirmMessage = friend.username
      ? `Bạn có chắc muốn xoá ${friend.username} khỏi danh sách bạn bè?`
      : 'Bạn có chắc muốn xoá người bạn này?';
    const confirmed = window.confirm(confirmMessage);
    if (!confirmed) {
      return;
    }
    setRemovingFriendId(friend.id);
    try {
      await onRemoveFriend(friend.id);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Không thể xoá bạn bè';
      window.alert(message);
    } finally {
      setRemovingFriendId(null);
    }
  };

  return (
    <div className="chat-sidebar">
      <div className="p-4">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-[var(--text-primary)]">{sectionTitle}</h2>
          {activeSection === 'conversations' && (
            <div className="flex items-center gap-2">
              <Popover
                onOpenChange={(open) => {
                  if (!open) {
                    setOptionsExpanded(false);
                  }
                }}
              >
                <PopoverTrigger asChild>
                  <Button variant="ghost" size="icon" className="size-9 rounded-full">
                    <MoreHorizontal className="size-5" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent
                  className="w-56 border theme-border bg-[var(--surface-bg)] p-2 text-[var(--text-primary)] shadow-lg animate-scale-pop"
                  align="end"
                >
                  <div className="flex flex-col">
                    <button
                      type="button"
                      onClick={handleOpenArchived}
                      className="rounded-md px-3 py-2 text-left text-sm text-muted-theme transition hover:bg-slate-100"
                    >
                      Tin nhắn lưu trữ
                      {archivedConversations.length > 0 && (
                        <span className="ml-2 inline-flex items-center justify-center rounded-full bg-slate-200 px-2 text-xs font-semibold text-muted-theme">
                          {archivedConversations.length}
                        </span>
                      )}
                    </button>
                    <button
                      type="button"
                      onClick={() => setOptionsExpanded((prev) => !prev)}
                      className="flex items-center justify-between rounded-md px-3 py-2 text-left text-sm font-semibold text-[var(--text-primary)] transition"
                    >
                      <span>Tuỳ chọn</span>
                      <ChevronDown
                        className={`size-4 transition-transform ${optionsExpanded ? 'rotate-180' : ''}`}
                      />
                    </button>
                    {optionsExpanded && (
                      <div className="mt-2 surface-card p-3 text-sm shadow-sm animate-fade-slide">
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <p className="font-medium text-[var(--text-primary)]">Chế độ tối</p>
                            <p className="text-xs text-muted-theme">
                              Bật giao diện nền tối cho toàn bộ ứng dụng.
                            </p>
                          </div>
                          <button
                            type="button"
                            onClick={handleToggleDarkMode}
                            className={`flex items-center rounded-full px-3 py-1 text-xs font-semibold transition ${
                              isDarkMode
                                ? 'bg-blue-600 text-white'
                                : 'bg-slate-200 text-[var(--text-primary)]'
                            }`}
                          >
                            {isDarkMode ? (
                              <>
                                <Moon className="mr-1 size-3.5" />
                                Đang bật
                              </>
                            ) : (
                              <>
                                <Sun className="mr-1 size-3.5" />
                                Đang tắt
                              </>
                            )}
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                </PopoverContent>
              </Popover>
              <Popover open={newChatOpen} onOpenChange={setNewChatOpen}>
                <PopoverTrigger asChild>
                  <Button variant="ghost" size="icon" className="size-9 rounded-full">
                    <SquarePen className="size-5" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent
                  className="flex h-[22rem] w-80 flex-col border theme-border bg-[var(--surface-bg)] p-0 shadow-xl animate-scale-pop"
                  align="end"
                >
                  <div className="border-b theme-border p-3">
                    <Button
                      type="button"
                      variant="ghost"
                      className="w-full justify-start px-0 text-left text-sm font-medium text-blue-600"
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
                          <div className="rounded-lg border border-dashed border-slate-200 bg-slate-50 px-4 py-6 text-center text-sm text-muted-theme dark:border-slate-600 dark:bg-slate-800/30">
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
                              className="flex w-full items-center gap-3 rounded-lg p-2 transition-colors"
                            >
                              <div className="relative">
                                <Avatar className="size-10">
                                  <AvatarFallback className="bg-blue-500 text-white">
                                    {friend.username ? getInitials(friend.username) : '?'}
                                  </AvatarFallback>
                                </Avatar>
                                {friend.isOnline && (
                                  <span className="absolute bottom-0 right-0 size-3 rounded-full border-2 border-white bg-green-500" />
                                )}
                              </div>
                              <div className="flex-1 text-left">
                                <div className="flex items-center gap-2">
                                  <p className="text-sm text-[var(--text-primary)]">{friend.username}</p>
                                  {friend.isOnline && (
                                    <span className="text-xs text-green-600 font-medium">Online</span>
                                  )}
                                </div>
                                {friend.email && (
                                  <p className="text-xs text-muted-theme">{friend.email}</p>
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
                className={`chip-button ${isActive ? 'chip-button--active' : ''}`}
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
              className="ml-3 text-xs font-semibold uppercase tracking-wide text-inherit transition"
            >
              Đóng
            </button>
          </div>
        )}

        {activeSection === 'conversations' && (
          <>
            <div className="mt-4 flex justify-center">
              <div className="relative w-full">
                <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-subtle-theme" />
                <Input
                  type="text"
                  placeholder="Tìm kiếm trên chat"
                  value={conversationSearchQuery}
                  onChange={(event) => setConversationSearchQuery(event.target.value)}
                  className="chat-search-input"
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
                    className={`chip-button ${isActive ? 'chip-button--active' : ''}`}
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
              <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-subtle-theme" />
              <Input
                type="text"
                placeholder="Tìm kiếm bạn bè theo tên hoặc email"
                value={friendSearchQuery}
                onChange={(event) => handleFriendSearchChange(event.target.value)}
                className="chat-search-input"
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
              <div className="px-6 py-8 text-center text-sm text-muted-theme">
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
                    className={`conversation-row ${isSelected ? 'conversation-row--active' : ''}`}
                  >
                    <Avatar className="size-12">
                      <AvatarFallback className="bg-blue-500 text-base font-semibold text-white">
                        {conversation.avatarFallback ?? getInitials(conversation.title)}
                      </AvatarFallback>
                    </Avatar>
                    <div className="min-w-0 flex-1">
                      <div className="mb-1 flex items-center justify-between gap-2">
                        <span
                          className={`conversation-row__title ${
                            isSelected ? 'conversation-row__title--active' : ''
                          }`}
                        >
                          {conversation.title}
                        </span>
                        <div className="flex items-center gap-1">
                          <span className="conversation-row__timestamp">
                            {formatTimestamp(conversation.updatedAt)}
                          </span>
                          <div
                            role="button"
                            tabIndex={0}
                            onClick={(event) => {
                              event.stopPropagation();
                              void handleArchiveConversationClick(conversation.id);
                            }}
                            onKeyDown={(event) => {
                              if (event.key === 'Enter' || event.key === ' ') {
                                event.preventDefault();
                                event.stopPropagation();
                                void handleArchiveConversationClick(conversation.id);
                              }
                            }}
                            className="rounded-full p-1 text-subtle-theme transition hover:bg-blue-500/10 hover:text-blue-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/50"
                            aria-label="Lưu trữ cuộc trò chuyện"
                          >
                            {archivingConversationId === conversation.id ? (
                              <Loader2 className="size-4 animate-spin" />
                            ) : (
                              <Archive className="size-4" />
                            )}
                          </div>
                        </div>
                      </div>
                      <p
                        className={`conversation-row__subtitle ${
                          (conversation.unreadCount ?? 0)
                            ? 'conversation-row__subtitle--unread'
                            : ''
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
                <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-theme">
                  Kết quả tìm kiếm
                </h3>
                {searching ? (
                  <div className="flex items-center gap-2 rounded-lg border theme-border bg-[var(--surface-bg)] px-4 py-3 text-sm text-muted-theme shadow-sm transition-colors">
                    <Loader2 className="size-4 animate-spin text-blue-500" />
                    Đang tìm kiếm...
                  </div>
                ) : searchResults.length === 0 ? (
                  <div className="rounded-lg border border-dashed border-slate-200 bg-slate-50 px-4 py-3 text-sm text-muted-theme dark:border-slate-600 dark:bg-slate-800/30">
                    Không tìm thấy người dùng phù hợp
                  </div>
                ) : (
                  <div className="space-y-3">
                    {searchResults.map((user) => (
                      <div
                        key={user.id}
                        className="flex items-center justify-between rounded-lg border theme-border bg-[var(--surface-bg)] px-4 py-3 shadow-sm"
                      >
                        <div>
                          <p className="text-sm font-medium text-[var(--text-primary)]">{user.username}</p>
                          <p className="text-xs text-muted-theme">{user.email}</p>
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
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-theme">
                Bạn bè
              </h3>
              {friends.length === 0 ? (
                <div className="rounded-lg border border-dashed border-slate-200 bg-slate-50 px-4 py-4 text-center text-sm text-muted-theme dark:border-slate-600 dark:bg-slate-800/30">
                  Bạn chưa có bạn bè nào. Hãy tìm và kết bạn để trò chuyện riêng tư.
                </div>
              ) : (
                <div className="space-y-3">
                  {friends.map((friend) => (
                    <div
                      key={friend.id}
                      className="flex items-center justify-between rounded-lg border theme-border bg-[var(--surface-bg)] px-4 py-3 shadow-sm"
                    >
                      <div className="flex items-center gap-3">
                        <div className="relative">
                          <Avatar className="size-10">
                            <AvatarFallback className="bg-blue-500 text-white">
                              {friend.username ? getInitials(friend.username) : '?'}
                            </AvatarFallback>
                          </Avatar>
                          {friend.isOnline && (
                            <span className="absolute bottom-0 right-0 size-3 rounded-full border-2 border-white bg-green-500" />
                          )}
                        </div>
                        <div>
                          <div className="flex items-center gap-2">
                            <p className="text-sm font-medium text-[var(--text-primary)]">
                              {friend.username}
                            </p>
                            {friend.isOnline && (
                              <span className="text-xs text-green-600 font-medium">Online</span>
                            )}
                          </div>
                          <p className="text-xs text-muted-theme">{friend.email}</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
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
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="rounded-full text-red-500 hover:bg-red-50 hover:text-red-600"
                          onClick={() => handleRemoveFriend(friend)}
                          disabled={removingFriendId === friend.id}
                          title="Xoá bạn bè"
                          aria-label="Xoá bạn bè"
                        >
                          {removingFriendId === friend.id ? (
                            <Loader2 className="size-4 animate-spin" />
                          ) : (
                            <UserMinus className="size-4" />
                          )}
                        </Button>
                      </div>
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
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-theme">
                Lời mời đến
              </h3>
              {incomingRequests.length === 0 ? (
                <div className="rounded-lg border border-dashed border-slate-200 bg-slate-50 px-4 py-4 text-center text-sm text-muted-theme dark:border-slate-600 dark:bg-slate-800/30">
                  Bạn chưa có lời mời kết bạn nào.
                </div>
              ) : (
                <div className="space-y-3">
                  {incomingRequests.map((request) => (
                    <div
                      key={request.id}
                      className="flex items-center justify-between rounded-lg border theme-border bg-[var(--surface-bg)] px-4 py-3 shadow-sm"
                    >
                      <div>
                        <p className="text-sm font-medium text-[var(--text-primary)]">
                          {request.user.username}
                        </p>
                        <p className="text-xs text-muted-theme">{request.user.email}</p>
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
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-theme">
                Đã gửi
              </h3>
              {outgoingRequests.length === 0 ? (
                <div className="rounded-lg border border-dashed border-slate-200 bg-slate-50 px-4 py-4 text-center text-sm text-muted-theme dark:border-slate-600 dark:bg-slate-800/30">
                  Bạn chưa gửi lời mời nào.
                </div>
              ) : (
                <div className="space-y-3">
                  {outgoingRequests.map((request) => (
                    <div
                      key={request.id}
                      className="flex items-center justify-between rounded-lg border theme-border bg-[var(--surface-bg)] px-4 py-3 shadow-sm"
                    >
                      <div>
                        <p className="text-sm font-medium text-[var(--text-primary)]">
                          {request.user.username}
                        </p>
                        <p className="text-xs text-muted-theme">{request.user.email}</p>
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

      {archivedOpen && (
        <div
          className="fixed inset-0 z-40 flex items-stretch justify-end bg-[var(--overlay-backdrop)] p-0 sm:p-6"
          onClick={handleCloseArchived}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="archived-conversations-title"
            className="glass-panel flex h-full w-full max-w-full flex-col overflow-hidden sm:max-w-lg sm:rounded-l-3xl animate-scale-pop"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b theme-border px-6 py-4">
              <div>
                <h2
                  id="archived-conversations-title"
                  className="text-lg font-semibold text-[var(--text-primary)]"
                >
                  Tin nhắn đã lưu trữ
                </h2>
                <p className="text-sm text-muted-theme">
                  Quản lý các cuộc trò chuyện đã lưu trữ của bạn.
                </p>
              </div>
              <button
                type="button"
                onClick={handleCloseArchived}
                className="rounded-full p-2 text-muted-theme transition hover:bg-blue-500/10"
              >
                <X className="size-4" />
                <span className="sr-only">Đóng</span>
              </button>
            </div>

            <div className="flex flex-1 flex-col gap-3 px-6 py-4">
              {archivedError && (
                <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">
                  {archivedError}
                </div>
              )}

              {archivedLoading ? (
                <div className="flex flex-1 items-center justify-center text-sm text-muted-theme">
                  <Loader2 className="mr-2 size-4 animate-spin text-blue-500" />
                  Đang tải danh sách tin nhắn lưu trữ...
                </div>
              ) : archivedConversations.length === 0 ? (
                <div className="flex flex-1 flex-col items-center justify-center rounded-xl border border-dashed border-slate-200 bg-slate-50 text-center text-sm text-muted-theme">
                  Bạn chưa lưu trữ cuộc trò chuyện nào.
                </div>
              ) : (
                <ScrollArea className="flex-1">
                  <div className="space-y-3 pr-2">
                    {archivedConversations.map((conversation) => {
                      const isProcessing = archivedActionId === conversation.id;
                      return (
                        <div
                          key={conversation.id}
                          className="flex items-center justify-between rounded-xl border theme-border bg-[var(--surface-bg)] px-4 py-3 shadow-sm transition-colors"
                        >
                          <div>
                            <p className="text-sm font-semibold text-[var(--text-primary)]">{conversation.title}</p>
                            <p className="text-xs text-muted-theme">
                              Lưu trữ lúc:{' '}
                              {conversation.archivedAt
                                ? formatTimestamp(conversation.archivedAt)
                                : formatTimestamp(conversation.updatedAt)}
                            </p>
                          </div>
                          <div className="flex items-center gap-2">
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              className="rounded-full"
                              disabled={isProcessing}
                              onClick={() => handleRestoreConversation(conversation.id, false)}
                            >
                              {isProcessing ? (
                                <Loader2 className="mr-2 size-3.5 animate-spin" />
                              ) : (
                                <ArchiveRestore className="mr-2 size-4" />
                              )}
                              Bỏ lưu trữ
                            </Button>
                            <Button
                              type="button"
                              size="sm"
                              className="rounded-full"
                              disabled={isProcessing}
                              onClick={() => handleRestoreConversation(conversation.id, true)}
                            >
                              {isProcessing ? (
                                <Loader2 className="mr-2 size-3.5 animate-spin" />
                              ) : null}
                              Mở
                            </Button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </ScrollArea>
              )}
            </div>
          </div>
        </div>
      )}

      {createGroupOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-[var(--overlay-backdrop)] p-4"
          onClick={closeGroupModal}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="create-group-title"
            className="glass-panel relative flex h-full max-h-[90vh] w-full max-w-[95vw] flex-col overflow-hidden rounded-xl sm:max-w-3xl animate-scale-pop"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-center justify-between gap-3 border-b theme-border px-6 py-4">
              <h2 id="create-group-title" className="text-left text-[18px] font-semibold text-[var(--text-primary)]">
                Tạo nhóm
              </h2>
              <button
                type="button"
                onClick={closeGroupModal}
                className="rounded-full p-1.5 text-subtle-theme transition"
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
                  className="w-full rounded-lg border theme-border px-3 py-2 text-sm focus-visible:ring-1 focus-visible:ring-blue-500/60"
                />
              </div>
              <div className="mt-4">
                <Input
                  type="text"
                  value={groupSearchQuery}
                  onChange={(event) => setGroupSearchQuery(event.target.value)}
                  placeholder="Nhập tên người dùng"
                  className="w-full rounded-lg border theme-border px-3 py-2 text-sm focus-visible:ring-1 focus-visible:ring-blue-500/60"
                />
              </div>
            </div>

            <div className="flex-1 overflow-hidden px-6">
              <div className="pb-2">
                <h3 className="text-sm font-medium text-[var(--text-primary)]">Trò chuyện gần đây</h3>
              </div>
              <div className="space-y-2">
                {recentConversationPreviews.length === 0 ? (
                  <p className="text-sm text-muted-theme">Chưa có cuộc trò chuyện phù hợp.</p>
                ) : (
                  recentConversationPreviews.map((conversation) => (
                    <button
                      key={conversation.id}
                      type="button"
                      className="flex w-full items-center justify-between rounded-lg border border-slate-200 px-3 py-2 text-left text-sm transition"
                    >
                      <span className="truncate font-medium text-[var(--text-primary)]">
                        {conversation.title}
                      </span>
                      {conversation.updatedAt && (
                        <span className="text-xs text-subtle-theme">
                          {formatTimestamp(conversation.updatedAt)}
                        </span>
                      )}
                    </button>
                  ))
                )}
              </div>

              <div className="mt-6 flex-1 overflow-hidden">
                <h3 className="mb-3 text-sm font-medium text-[var(--text-primary)]">Danh bạ</h3>
              <div className="mb-2 flex items-center justify-between text-xs">
                <span className="text-muted-theme">Đã chọn {selectedGroupCount} thành viên</span>
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
                      <p className="text-sm text-muted-theme">
                        {friends.length === 0
                          ? 'Bạn chưa có bạn bè trong danh sách.'
                          : 'Không tìm thấy bạn bè phù hợp với tìm kiếm.'}
                      </p>
                    ) : (
                      groupedFriendEntries.map(([letter, items]) => (
                        <div key={letter} className="space-y-2">
                          <p className="text-xs font-semibold uppercase tracking-wide text-subtle-theme">
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
                                  : 'border-slate-200'
                              } ${creatingGroup ? 'cursor-not-allowed opacity-60' : ''}`}
                              >
                                <div className="flex items-center gap-3">
                                  <div className="relative">
                                    <Avatar className="size-8">
                                      <AvatarFallback className="bg-blue-500 text-sm font-semibold text-white">
                                        {friend.username ? getInitials(friend.username) : '?'}
                                      </AvatarFallback>
                                    </Avatar>
                                    {friend.isOnline && (
                                      <span className="absolute bottom-0 right-0 size-3 rounded-full border-2 border-white bg-green-500" />
                                    )}
                                  </div>
                                  <div className="flex-1">
                                    <div className="flex items-center gap-2">
                                      <p className="text-sm font-medium text-[var(--text-primary)]">
                                        {friend.username}
                                      </p>
                                      {friend.isOnline && (
                                        <span className="text-xs text-green-600 font-medium">Online</span>
                                      )}
                                    </div>
                                    {friend.email && (
                                      <p className="text-xs text-muted-theme">{friend.email}</p>
                                    )}
                                  </div>
                                </div>
                                <span
                                  className={`flex size-5 items-center justify-center rounded-full border transition ${
                                    isSelected
                                      ? 'border-blue-500 bg-blue-500 text-white'
                                      : 'border-slate-300 text-subtle-theme'
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
