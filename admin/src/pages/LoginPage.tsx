import { FormEvent, useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useLocale } from '../context/LocaleContext';
import { Button, Input } from '../components/ui';

const BOT_USERNAME = import.meta.env.VITE_LOGIN_BOT_USERNAME ?? 'salonbot_login_bot';

export function LoginPage() {
  const { login, loginWithEmail, isAuthenticated } = useAuth();
  const { t, lang, setLang } = useLocale();
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
    <div className="login-shell">
      <div className="login-card">
        <div className="brand">
          <span className="brand-mark">SB</span>
          <div style={{ textAlign: 'left' }}>
            SalonBot
            <small>{t('brand_sub')}</small>
          </div>
        </div>
        <p className="login-sub">{t('login_sub')}</p>

        <div className="login-tabs">
          <button type="button" className={mode === 'email' ? 'active' : ''} onClick={() => setMode('email')}>
            {t('login_tab_email')}
          </button>
          <button type="button" className={mode === 'telegram' ? 'active' : ''} onClick={() => setMode('telegram')}>
            {t('login_tab_telegram')}
          </button>
        </div>

        {error && <div className="notice-error" style={{ textAlign: 'left', marginBottom: 12 }}>{error}</div>}

        {mode === 'email' ? (
          <form onSubmit={submitEmail} className="form-grid" style={{ gridTemplateColumns: '1fr', textAlign: 'left' }}>
            <label className="full">
              {t('login_email')}
              <Input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
            </label>
            <label className="full">
              {t('login_password')}
              <Input type="password" required value={password} onChange={(e) => setPassword(e.target.value)} />
            </label>
            <Button type="submit" className="full" disabled={loading}>
              {loading ? t('login_loading') : t('login_submit')}
            </Button>
          </form>
        ) : (
          <div ref={containerRef} className="flex justify-center" />
        )}

        <div className="client-period-presets" style={{ justifyContent: 'center', marginTop: 16 }}>
          {(
            [
              ['uk', 'lang_uk'],
              ['ru', 'lang_ru'],
              ['en', 'lang_en'],
            ] as const
          ).map(([code, key]) => (
            <button
              key={code}
              type="button"
              className={`chip-btn${lang === code ? ' active' : ''}`}
              onClick={() => setLang(code)}
            >
              {t(key)}
            </button>
          ))}
        </div>

        <p className="login-sub" style={{ marginTop: 18, marginBottom: 0 }}>
          {t('login_onboarding')}{' '}
          <Link to="/onboarding" className="text-link">{t('login_connect')}</Link>
        </p>
      </div>
    </div>
  );
}
