import { useEffect, useMemo, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { io, type Socket } from 'socket.io-client';

type Message = {
  _id: string;
  sender: string;
  content: string;
  createdAt: string;
};

const API_BASE_URL =
  (import.meta.env.VITE_API_BASE_URL as string | undefined)?.replace(/\/$/, '') ?? '';
const SOCKET_URL = API_BASE_URL || window.location.origin.replace(/\/$/, '');

const App = () => {
  const [messages, setMessages] = useState<Message[]>([]);
  const [sender, setSender] = useState('');
  const [content, setContent] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const socketRef = useRef<Socket | null>(null);

  const upsertMessage = (message: Message) => {
    setMessages((prev) => {
      const exists = prev.some((item) => item._id === message._id);
      if (exists) {
        return prev;
      }
      return [...prev, message].sort(
        (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
      );
    });
  };

  const hasMessages = useMemo(() => messages.length > 0, [messages]);

  const fetchMessages = async () => {
    setLoading(true);
    setError(null);

    try {
      const response = await fetch(`${API_BASE_URL}/api/messages`);

      if (!response.ok) {
        throw new Error('Không thể tải danh sách tin nhắn');
      }

      const data: Message[] = await response.json();
      setMessages(
        data.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
      );
    } catch (err) {
      console.error(err);
      setError(err instanceof Error ? err.message : 'Lỗi không xác định');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchMessages();
  }, []);

  useEffect(() => {
    const socket = io(SOCKET_URL, {
      transports: ['websocket'],
      withCredentials: true,
    });

    socketRef.current = socket;

    socket.on('connect_error', (socketError) => {
      console.error('Socket connection error:', socketError);
    });

    socket.on('message:new', (message: Message) => {
      upsertMessage(message);
    });

    return () => {
      socket.disconnect();
      socketRef.current = null;
    };
  }, []);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!sender.trim() || !content.trim()) {
      setError('Vui lòng nhập tên và nội dung tin nhắn');
      return;
    }

    setSubmitting(true);
    setError(null);

    try {
      const payload = { sender: sender.trim(), content: content.trim() };
      const socket = socketRef.current;

      if (socket?.connected) {
        await new Promise<void>((resolve, reject) => {
          socket.timeout(5000).emit('message:send', payload, (response: unknown) => {
            const data = response as
              | { status: 'ok'; data: Message }
              | { status: 'error'; error?: string };

            if (data?.status === 'ok') {
              resolve();
              return;
            }

            reject(new Error(data?.error ?? 'Không thể gửi tin nhắn'));
          });
        });
      } else {
        const response = await fetch(`${API_BASE_URL}/api/messages`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });

        if (!response.ok) {
          throw new Error('Không thể gửi tin nhắn');
        }

        const message: Message = await response.json();
        upsertMessage(message);
      }
      setContent('');
    } catch (err) {
      console.error(err);
      setError(err instanceof Error ? err.message : 'Lỗi không xác định');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="app">
      <header className="header">
        <h1>Chat App</h1>
        <button className="refresh" onClick={fetchMessages} disabled={loading}>
          Làm mới
        </button>
      </header>

      <main className="content">
        <section className="messages">
          {loading && <p>Đang tải tin nhắn...</p>}
          {error && <p className="error">{error}</p>}
          {!loading && !hasMessages && !error && <p>Chưa có tin nhắn nào</p>}

          <ul>
            {messages.map((message) => (
              <li key={message._id}>
                <div className="meta">
                  <span className="sender">{message.sender}</span>
                  <span className="time">
                    {new Date(message.createdAt).toLocaleString()}
                  </span>
                </div>
                <p className="text">{message.content}</p>
              </li>
            ))}
          </ul>
        </section>

        <form className="composer" onSubmit={handleSubmit}>
          <label>
            Tên của bạn
            <input
              type="text"
              value={sender}
              onChange={(event) => setSender(event.target.value)}
              placeholder="Nhập tên..."
            />
          </label>
          <label>
            Tin nhắn
            <textarea
              value={content}
              onChange={(event) => setContent(event.target.value)}
              placeholder="Viết gì đó..."
              rows={3}
            />
          </label>
          <button type="submit" disabled={submitting}>
            {submitting ? 'Đang gửi...' : 'Gửi tin'}
          </button>
        </form>
      </main>
    </div>
  );
};

export default App;

