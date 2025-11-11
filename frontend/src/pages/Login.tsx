import { useState } from 'react';
import { useAuth } from '../AuthContext';

export default function Login({ goRegister, goChat }: { goRegister: () => void; goChat: () => void }) {
  const { login } = useAuth();
  const [emailOrUsername, setEmailOrUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await login(emailOrUsername.trim(), password);
      goChat();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Đăng nhập thất bại');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="app" style={{ maxWidth: 420 }}>
      <h1>Đăng nhập</h1>
      {error && <p className="error">{error}</p>}
      <form className="composer" onSubmit={submit}>
        <label>
          Email hoặc Username
          <input value={emailOrUsername} onChange={(e) => setEmailOrUsername(e.target.value)} />
        </label>
        <label>
          Mật khẩu
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
        </label>
        <button type="submit" disabled={loading}>{loading ? 'Đang đăng nhập...' : 'Đăng nhập'}</button>
      </form>
      <div style={{ textAlign: 'center' }}>
        <button className="refresh" onClick={goRegister} disabled={loading}>Chưa có tài khoản? Đăng ký</button>
      </div>
    </div>
  );
}


