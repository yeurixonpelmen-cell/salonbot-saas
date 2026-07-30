import { FormEvent, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { clearToken } from '../api';
import { useAuth } from '../context/AuthContext';
import { useLocale } from '../context/LocaleContext';
import { Button, Input } from '../components/ui';

export function LoginPage() {
  const { loginWithEmail, refreshAuth } = useAuth();
  const { t, lang, setLang } = useLocale();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  // Always show login form — drop any stale session (deleted salon / restored tab).
  useEffect(() => {
    clearToken();
    refreshAuth();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only on first open of /login
  }, []);

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
          <span className="brand-mark">Kelando</span>
          <div style={{ textAlign: 'left' }}>
            <small>{t('brand_sub')}</small>
          </div>
        </div>
        <p className="login-sub">{t('login_sub')}</p>

        {error && <div className="notice-error" style={{ textAlign: 'left', marginBottom: 12 }}>{error}</div>}

        <form
          onSubmit={submitEmail}
          className="form-grid"
          style={{ gridTemplateColumns: '1fr', textAlign: 'left' }}
          autoComplete="on"
        >
          <label className="full">
            {t('login_email')}
            <Input
              type="email"
              name="username"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="username"
              inputMode="email"
            />
          </label>
          <label className="full">
            {t('login_password')}
            <Input
              type="password"
              name="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
            />
          </label>
          <Button type="submit" className="full" disabled={loading}>
            {loading ? t('login_loading') : t('login_submit')}
          </Button>
        </form>

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
