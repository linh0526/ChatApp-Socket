import { useEffect, useMemo, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { io, type Socket } from 'socket.io-client';
import { AuthProvider, useAuth } from './AuthContext';
import { authHeaders, getToken } from './auth';
import Login from './pages/Login';
import Register from './pages/Register';

type Message = {
  _id: string;
  sender: string;
  content: string;
  createdAt: string;
};

const API_BASE_URL =
  (import.meta.env.VITE_API_BASE_URL as string | undefined)?.replace(/\/$/, '') ?? '';
const SOCKET_URL = API_BASE_URL || window.location.origin.replace(/\/$/, '');

function Chat() {
  const { token, logout } = useAuth();
  const [messages, setMessages] = useState<Message[]>([]);
  const [content, setContent] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const socketRef = useRef<Socket | null>(null);

  const upsertMessage = (message: Message) => {
    setMessages((prev) => {
      const exists = prev.some((item) => item._id === message._id);
      if (exists) return prev;
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
      const response = await fetch(`${API_BASE_URL}/api/messages`, {
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
      });
      if (!response.ok) throw new Error('Không thể tải danh sách tin nhắn');
      const data: Message[] = await response.json();
      setMessages(
        data.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Lỗi không xác định');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!token) return;
    fetchMessages();
  }, [token]);

  useEffect(() => {
    if (!token) return;
    const socket = io(SOCKET_URL, { transports: ['websocket'], withCredentials: true });
    socketRef.current = socket;
    socket.on('message:new', (message: Message) => upsertMessage(message));
    return () => {
      socket.disconnect();
      socketRef.current = null;
    };
  }, [token]);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!content.trim()) {
      setError('Vui lòng nhập nội dung tin nhắn');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const payload = { token: getToken(), content: content.trim() };
      const socket = socketRef.current;
      if (socket?.connected) {
        await new Promise<void>((resolve, reject) => {
          socket.timeout(5000).emit('message:send', payload, (response: unknown) => {
            const data = response as
              | { status: 'ok'; data: Message }
              | { status: 'error'; error?: string };
            if (data?.status === 'ok') return resolve();
            reject(new Error(data?.error ?? 'Không thể gửi tin nhắn'));
          });
        });
      } else {
        const response = await fetch(`${API_BASE_URL}/api/messages`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...authHeaders() },
          body: JSON.stringify(payload),
        });
        if (!response.ok) throw new Error('Không thể gửi tin nhắn');
        const message: Message = await response.json();
        upsertMessage(message);
      }
      setContent('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Lỗi không xác định');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="app">
      <header className="header">
        <h1>Chat App</h1>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="refresh" onClick={fetchMessages} disabled={loading}>Làm mới</button>
          <button className="refresh" onClick={logout}>Đăng xuất</button>
        </div>
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
                  <span className="time">{new Date(message.createdAt).toLocaleString()}</span>
                </div>
                <p className="text">{message.content}</p>
              </li>
            ))}
          </ul>
        </section>

        <form className="composer" onSubmit={handleSubmit}>
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
}

function App() {
  const [view, setView] = useState<'login' | 'register' | 'chat'>(() => {
    const t = getToken();
    return t ? 'chat' : 'login';
  });
  const goLogin = () => setView('login');
  const goRegister = () => setView('register');
  const goChat = () => setView('chat');

  return (
    <AuthProvider>
      {view === 'login' && <Login goRegister={goRegister} goChat={goChat} />}
      {view === 'register' && <Register goLogin={goLogin} goChat={goChat} />}
      {view === 'chat' && <Chat />}
    </AuthProvider>
  );
}

export default App;

