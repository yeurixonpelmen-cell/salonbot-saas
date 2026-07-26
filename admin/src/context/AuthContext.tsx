import { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { api, setToken, clearToken, getToken as readToken } from '../api';

interface AuthContextType {
  isAuthenticated: boolean;
  login: (telegramData: Record<string, string>) => Promise<void>;
  loginWithEmail: (email: string, password: string) => Promise<void>;
  logout: () => void;
  selectSalon: (salonId: string, selectionToken: string) => Promise<void>;
  refreshAuth: () => void;
}

const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [isAuthenticated, setIsAuthenticated] = useState(!!readToken());

  useEffect(() => {
    setIsAuthenticated(!!readToken());
  }, []);

  async function login(telegramData: Record<string, string>) {
    const result = await api.post<{
      token?: string;
      needsOnboarding?: boolean;
      needsEmailOnboarding?: boolean;
      needsSalonPick?: boolean;
      ownerTelegramId?: number;
      selectionToken?: string;
      salons?: { id: string; name_uk: string }[];
      error?: string;
    }>('/api/auth/telegram', telegramData);

    if (result.needsEmailOnboarding || result.needsOnboarding) {
      window.location.href = '/onboarding';
      return;
    }

    if (result.needsSalonPick && result.salons) {
      sessionStorage.setItem('salon_pick_list', JSON.stringify(result.salons));
      sessionStorage.setItem('salon_pick_token', result.selectionToken ?? '');
      window.location.href = '/select-salon';
      return;
    }

    if (result.token) {
      setToken(result.token);
      setIsAuthenticated(true);
    }
  }

  async function loginWithEmail(email: string, password: string) {
    const result = await api.post<{ token: string }>('/api/auth/email', { email, password });
    setToken(result.token);
    setIsAuthenticated(true);
  }

  async function selectSalon(salonId: string, selectionToken: string) {
    const result = await api.post<{ token: string }>('/api/auth/select-salon', {
      salonId,
      selectionToken,
    });
    setToken(result.token);
    setIsAuthenticated(true);
  }

  function logout() {
    clearToken();
    setIsAuthenticated(false);
  }

  function refreshAuth() {
    setIsAuthenticated(!!readToken());
  }

  return (
    <AuthContext.Provider value={{ isAuthenticated, login, loginWithEmail, logout, selectSalon, refreshAuth }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
