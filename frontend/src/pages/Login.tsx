import { useState } from 'react';
import { useAuth } from '../AuthContext';
import { Button } from '../ui/button';
import { Input } from '../ui/input';

interface LoginProps {
  goRegister: () => void;
  goChat: () => void;
}

export default function Login({ goRegister, goChat }: LoginProps) {
  const { login } = useAuth();
  const [emailOrUsername, setEmailOrUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
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
    <div className="flex min-h-screen items-center justify-center bg-slate-100 px-4">
      <div className="w-full max-w-md rounded-2xl bg-white p-8 shadow-panel">
        <div className="space-y-2 text-center">
          <h1 className="text-2xl font-semibold text-slate-900">Đăng nhập</h1>
          <p className="text-sm text-slate-500">Chào mừng bạn quay lại với Chat App</p>
        </div>

        {error && (
          <div className="mt-6 rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-600">
            {error}
          </div>
        )}

        <form className="mt-6 space-y-5" onSubmit={submit}>
          <div className="space-y-2">
            <label className="text-sm font-medium text-slate-700" htmlFor="login-identifier">
              Email hoặc Username
            </label>
            <Input
              id="login-identifier"
              placeholder="nguyenvana hoặc email@example.com"
              autoComplete="username"
              value={emailOrUsername}
              onChange={(event) => setEmailOrUsername(event.target.value)}
              disabled={loading}
              required
            />
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium text-slate-700" htmlFor="login-password">
              Mật khẩu
            </label>
            <Input
              id="login-password"
              type="password"
              placeholder="••••••••"
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              disabled={loading}
              required
            />
          </div>

          <Button type="submit" className="w-full rounded-full py-2" disabled={loading}>
            {loading ? 'Đang đăng nhập...' : 'Đăng nhập'}
          </Button>
        </form>

        <div className="mt-6 text-center">
          <Button
            type="button"
            variant="outline"
            className="w-full rounded-full"
            onClick={goRegister}
            disabled={loading}
          >
            Chưa có tài khoản? Đăng ký
          </Button>
        </div>
      </div>
    </div>
  );
}
