import { useEffect, useRef } from 'react';
import { useAuth } from '../context/AuthContext';
import { useNavigate } from 'react-router-dom';

const BOT_USERNAME = import.meta.env.VITE_LOGIN_BOT_USERNAME ?? 'salonbot_login_bot';

export function LoginPage() {
  const { login, isAuthenticated } = useAuth();
  const navigate = useNavigate();
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isAuthenticated) navigate('/');
  }, [isAuthenticated, navigate]);

  useEffect(() => {
    if (!containerRef.current) return;

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
  }, [login, navigate]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="bg-white p-8 rounded-2xl shadow-sm border border-gray-200 text-center max-w-sm w-full">
        <h1 className="text-2xl font-bold mb-2">SalonBot Admin</h1>
        <p className="text-gray-600 mb-6">Увійдіть через Telegram</p>
        <div ref={containerRef} className="flex justify-center" />
        <p className="text-sm text-gray-500 mt-6">
          Новий салон?{' '}
          <a href="/onboarding" className="text-blue-600 hover:underline">
            Підключитись
          </a>
        </p>
      </div>
    </div>
  );
}
