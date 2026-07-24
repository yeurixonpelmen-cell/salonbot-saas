import { FormEvent, useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

const BOT_USERNAME = import.meta.env.VITE_LOGIN_BOT_USERNAME ?? 'salonbot_login_bot';

export function LoginPage() {
  const { login, loginWithEmail, isAuthenticated } = useAuth();
  const navigate = useNavigate();
  const containerRef = useRef<HTMLDivElement>(null);
  const [mode, setMode] = useState<'email' | 'telegram'>('email');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (isAuthenticated) navigate('/');
  }, [isAuthenticated, navigate]);

  useEffect(() => {
    if (mode !== 'telegram' || !containerRef.current) return;

    (window as unknown as { onTelegramAuth?: (user: Record<string, string>) => void }).onTelegramAuth =
      async (user: Record<string, string>) => {
        try {
          await login(user);
        } catch (err) {
          console.error(err);
        }
      };

    const script = document.createElement('script');
    script.src = 'https://telegram.org/js/telegram-widget.js?22';
    script.async = true;
    script.setAttribute('data-telegram-login', BOT_USERNAME);
    script.setAttribute('data-size', 'large');
    script.setAttribute('data-onauth', 'onTelegramAuth(user)');
    script.setAttribute('data-request-access', 'write');
    containerRef.current.innerHTML = '';
    containerRef.current.appendChild(script);

    return () => {
      delete (window as unknown as { onTelegramAuth?: (user: Record<string, string>) => void })
        .onTelegramAuth;
      script.remove();
    };
  }, [login, mode]);

  async function submitEmail(event: FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError('');
    try {
      await loginWithEmail(email, password);
      navigate('/');
    } catch (err) {
      setError((err as { error?: string }).error ?? 'Не вдалось увійти');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 p-4">
      <div className="bg-white p-8 rounded-2xl shadow-sm border border-gray-200 text-center max-w-sm w-full space-y-4">
        <div>
          <h1 className="text-2xl font-bold mb-2">SalonBot Admin</h1>
          <p className="text-gray-600">Вхід у кабінет салону</p>
        </div>

        <div className="flex rounded-lg border overflow-hidden">
          <button
            type="button"
            className={`flex-1 py-2 text-sm ${mode === 'email' ? 'bg-blue-600 text-white' : 'bg-white'}`}
            onClick={() => setMode('email')}
          >
            Email
          </button>
          <button
            type="button"
            className={`flex-1 py-2 text-sm ${mode === 'telegram' ? 'bg-blue-600 text-white' : 'bg-white'}`}
            onClick={() => setMode('telegram')}
          >
            Telegram
          </button>
        </div>

        {error && <div className="rounded-lg bg-red-50 border border-red-200 p-3 text-red-800 text-sm text-left">{error}</div>}

        {mode === 'email' ? (
          <form onSubmit={submitEmail} className="space-y-3 text-left">
            <label className="block">
              <span className="text-sm text-gray-600">Email</span>
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full border rounded-lg p-3 mt-1"
              />
            </label>
            <label className="block">
              <span className="text-sm text-gray-600">Пароль</span>
              <input
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full border rounded-lg p-3 mt-1"
              />
            </label>
            <button type="submit" disabled={loading} className="w-full py-3 rounded-lg bg-blue-600 text-white font-medium">
              {loading ? 'Вхід…' : 'Увійти'}
            </button>
          </form>
        ) : (
          <div ref={containerRef} className="flex justify-center" />
        )}

        <p className="text-sm text-gray-500">
          Новий салон через Telegram?{' '}
          <Link to="/onboarding" className="text-blue-600 hover:underline">
            Підключитись
          </Link>
        </p>
      </div>
    </div>
  );
}
