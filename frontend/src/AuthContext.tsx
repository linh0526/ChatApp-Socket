import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { apiLogin, apiRegister, clearAuth, getToken, getUser, setAuth } from './auth';
import type { AuthUser } from './auth';

type AuthContextValue = {
  user: AuthUser | null;
  token: string | null;
  login: (emailOrUsername: string, password: string) => Promise<void>;
  register: (username: string, email: string, password: string) => Promise<void>;
  logout: () => void;
};

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [token, setToken] = useState<string | null>(null);

  useEffect(() => {
    setUser(getUser());
    setToken(getToken());
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      token,
      async login(emailOrUsername, password) {
        const { token, user } = await apiLogin(emailOrUsername, password);
        setAuth(token, user);
        setUser(user);
        setToken(token);
      },
      async register(username, email, password) {
        const { token, user } = await apiRegister(username, email, password);
        setAuth(token, user);
        setUser(user);
        setToken(token);
      },
      logout() {
        clearAuth();
        setUser(null);
        setToken(null);
      },
    }),
    [user, token]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}


