import { useState } from 'react';
import { useAuth } from '../AuthContext';
import { Button } from '../ui/button';
import { Input } from '../ui/input';

interface RegisterProps {
  goLogin: () => void;
  goChat: () => void;
}

export default function Register({ goLogin, goChat }: RegisterProps) {
  const { register } = useAuth();
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
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
    <div className="flex min-h-screen items-center justify-center bg-slate-100 px-4">
      <div className="w-full max-w-md rounded-2xl bg-white p-8 shadow-panel">
        <div className="space-y-2 text-center">
          <h1 className="text-2xl font-semibold text-slate-900">Đăng ký</h1>
          <p className="text-sm text-slate-500">Tạo tài khoản để bắt đầu trò chuyện</p>
        </div>

        {error && (
          <div className="mt-6 rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-600">
            {error}
          </div>
        )}

        <form className="mt-6 space-y-5" onSubmit={submit}>
          <div className="space-y-2">
            <label className="text-sm font-medium text-slate-700" htmlFor="register-username">
              Username
            </label>
            <Input
              id="register-username"
              placeholder="nguyenvana"
              autoComplete="username"
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              disabled={loading}
              required
            />
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium text-slate-700" htmlFor="register-email">
              Email
            </label>
            <Input
              id="register-email"
              type="email"
              placeholder="email@example.com"
              autoComplete="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              disabled={loading}
              required
            />
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium text-slate-700" htmlFor="register-password">
              Mật khẩu
            </label>
            <Input
              id="register-password"
              type="password"
              placeholder="••••••••"
              autoComplete="new-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              disabled={loading}
              required
            />
          </div>

          <Button type="submit" className="w-full rounded-full py-2" disabled={loading}>
            {loading ? 'Đang đăng ký...' : 'Đăng ký'}
          </Button>
        </form>

        <div className="mt-6 text-center">
          <Button
            type="button"
            variant="outline"
            className="w-full rounded-full"
            onClick={goLogin}
            disabled={loading}
          >
            Đã có tài khoản? Đăng nhập
          </Button>
        </div>
      </div>
    </div>
  );
}
