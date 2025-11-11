import { useState } from 'react';
import { useAuth } from '../AuthContext';

export default function Register({ goLogin, goChat }: { goLogin: () => void; goChat: () => void }) {
  const { register } = useAuth();
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await register(username.trim(), email.trim(), password);
      goChat();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Đăng ký thất bại');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="app" style={{ maxWidth: 420 }}>
      <h1>Đăng ký</h1>
      {error && <p className="error">{error}</p>}
      <form className="composer" onSubmit={submit}>
        <label>
          Username
          <input value={username} onChange={(e) => setUsername(e.target.value)} />
        </label>
        <label>
          Email
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        </label>
        <label>
          Mật khẩu
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
        </label>
        <button type="submit" disabled={loading}>{loading ? 'Đang đăng ký...' : 'Đăng ký'}</button>
      </form>
      <div style={{ textAlign: 'center' }}>
        <button className="refresh" onClick={goLogin} disabled={loading}>Đã có tài khoản? Đăng nhập</button>
      </div>
    </div>
  );
}


