import { useMemo, useState } from 'react';
import { MoreHorizontal, SquarePen, Search } from 'lucide-react';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Popover, PopoverContent, PopoverTrigger } from './ui/popover';
import { Avatar, AvatarFallback } from './ui/avatar';
import type { ConversationPreview } from './ChatLayout';

interface ChatSidebarProps {
  conversations: ConversationPreview[];
  selectedConversationId: string | null;
  onSelectConversation: (id: string) => void;
}

type FilterType = 'all' | 'unread' | 'groups';

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
}: ChatSidebarProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [filter, setFilter] = useState<FilterType>('all');

  const filteredConversations = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();

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
  }, [conversations, filter, searchQuery]);

  return (
    <div className="chat-sidebar">
      <div className="p-4">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-slate-900">Đoạn chat</h2>
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
        </div>

        <div className="flex justify-center">
          <div className="relative w-full">
            <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
            <Input
              type="text"
              placeholder="Tìm kiếm trên chat"
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
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
      </div>

      <div className="chat-sidebar__list flex-1 overflow-y-auto">
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
                    {conversation.lastMessageSnippet || conversation.subtitle || 'Chưa có tin nhắn'}
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
      </div>
    </div>
  );
}
