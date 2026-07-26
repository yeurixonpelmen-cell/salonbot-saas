import { ChangeEvent, FormEvent, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, setToken } from '../api';
import { useAuth } from '../context/AuthContext';

type Step = 0 | 1 | 2 | 3 | 4;

const ONBOARDING_TOKEN_KEY = 'onboarding_token';
const ONBOARDING_EMAIL_KEY = 'onboarding_email';

export function OnboardingPage() {
  const { refreshAuth } = useAuth();
  const [step, setStep] = useState<Step>(0);
  const [onboardingToken, setOnboardingToken] = useState(() => sessionStorage.getItem(ONBOARDING_TOKEN_KEY) ?? '');
  const [ownerEmail, setOwnerEmail] = useState(() => sessionStorage.getItem(ONBOARDING_EMAIL_KEY) ?? '');
  const [activationCode, setActivationCode] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [nameUk, setNameUk] = useState('');
  const [nameEn, setNameEn] = useState('');
  const [address, setAddress] = useState('');
  const [logoUrl, setLogoUrl] = useState('');
  const [rawBotToken, setRawBotToken] = useState('');
  const [botUsername, setBotUsername] = useState('');
  const [adminChatId, setAdminChatId] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (onboardingToken && ownerEmail && step === 0) setStep(1);
  }, [onboardingToken, ownerEmail, step]);

  function clearOnboardingSession() {
    sessionStorage.removeItem(ONBOARDING_TOKEN_KEY);
    sessionStorage.removeItem(ONBOARDING_EMAIL_KEY);
    sessionStorage.removeItem('onboarding_owner_id');
    sessionStorage.removeItem('onboarding_first_name');
    sessionStorage.removeItem('onboarding_owner_auth');
    setOnboardingToken('');
    setOwnerEmail('');
  }

  async function claimCode(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError('');
    setMessage('');
    try {
      const result = await api.post<{ onboardingToken: string; email: string }>('/api/onboarding/claim', {
        code: activationCode,
        email,
        password,
      });
      sessionStorage.setItem(ONBOARDING_TOKEN_KEY, result.onboardingToken);
      sessionStorage.setItem(ONBOARDING_EMAIL_KEY, result.email);
      setOnboardingToken(result.onboardingToken);
      setOwnerEmail(result.email);
      setMessage('Код прийнято. Далі налаштуйте салон.');
      setStep(1);
    } catch (err) {
      setError((err as { error?: string }).error ?? 'Не вдалось активувати код');
    } finally {
      setLoading(false);
    }
  }

  async function uploadLogo(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    const form = new FormData();
    form.append('logo', file);
    setLoading(true);
    setError('');
    try {
      const { url } = await api.post<{ url: string }>('/api/onboarding/logo', form);
      setLogoUrl(url);
      setMessage('Логотип завантажено');
    } catch (err) {
      setError((err as { error?: string }).error ?? 'Не вдалось завантажити логотип');
    } finally {
      setLoading(false);
    }
  }

  async function verifyBot() {
    setLoading(true);
    setError('');
    setMessage('');
    try {
      const result = await api.post<{ ok: boolean; username?: string; error?: string }>(
        '/api/onboarding/verify-bot',
        { token: rawBotToken }
      );
      if (!result.ok || !result.username) {
        setError('Токен невірний, спробуйте ще раз');
        return;
      }
      setBotUsername(result.username);
      setMessage(`Бот @${result.username} знайдено`);
    } catch (err) {
      setError((err as { error?: string }).error ?? 'Не вдалось перевірити токен');
    } finally {
      setLoading(false);
    }
  }

  async function verifyChat() {
    setLoading(true);
    setError('');
    setMessage('');
    try {
      const result = await api.post<{ ok: boolean }>('/api/onboarding/verify-chat', {
        botToken: rawBotToken,
        chatId: adminChatId,
      });
      if (!result.ok) {
        setError('Не вдалось надіслати тестове повідомлення. Перевірте chat_id і права бота.');
        return;
      }
      setMessage('Сповіщення налаштовано');
    } catch (err) {
      setError((err as { error?: string }).error ?? 'Не вдалось перевірити chat_id');
    } finally {
      setLoading(false);
    }
  }

  async function finish() {
    if (!onboardingToken) {
      clearOnboardingSession();
      setError('Сесія онбордингу відсутня. Введіть код і email знову.');
      setStep(0);
      return;
    }
    setLoading(true);
    setError('');
    try {
      const result = await api.post<{ salonId: string; token: string; botUsername: string }>(
        '/api/onboarding/complete',
        {
          onboardingToken,
          nameUk,
          nameEn,
          address,
          logoUrl,
          rawBotToken,
          botUsername,
          adminChatId,
        }
      );
      setToken(result.token);
      refreshAuth();
      clearOnboardingSession();
      setStep(4);
    } catch (err) {
      const msg = (err as { error?: string }).error ?? 'Не вдалось завершити онбординг';
      if (msg.toLowerCase().includes('сесія') || msg.toLowerCase().includes('онбординг')) {
        clearOnboardingSession();
        setStep(0);
      }
      setError(msg);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-gray-50 p-4 flex justify-center">
      <div className="w-full max-w-2xl space-y-4">
        <div className="bg-white border rounded-2xl p-5">
          <h1 className="text-2xl font-bold">Підключення салону</h1>
          <p className="text-gray-500">Крок {step} з 4</p>
          <div className="mt-4 h-2 bg-gray-100 rounded-full overflow-hidden">
            <div className="h-full bg-blue-600" style={{ width: `${((step + 1) / 5) * 100}%` }} />
          </div>
        </div>

        {message && <div className="rounded-xl bg-green-50 border border-green-200 p-3 text-green-800">{message}</div>}
        {error && <div className="rounded-xl bg-red-50 border border-red-200 p-3 text-red-800">{error}</div>}

        <div className="bg-white border rounded-2xl p-5">
          {step === 0 && (
            <form onSubmit={claimCode} className="space-y-4">
              <h2 className="text-xl font-semibold">Крок 0 — Код і email</h2>
              <p className="text-gray-500 text-sm">
                Один код = один салон. Після активації входите в адмінку цим email і паролем.
              </p>
              <Input label="Код активації *" value={activationCode} onChange={setActivationCode} required />
              <Input label="Email власника *" value={email} onChange={setEmail} type="email" required />
              <Input
                label="Пароль (мін. 8 символів) *"
                value={password}
                onChange={setPassword}
                type="password"
                required
              />
              <button
                type="submit"
                disabled={loading}
                className="w-full py-3 rounded-lg bg-blue-600 text-white font-medium disabled:opacity-60"
              >
                {loading ? 'Перевірка…' : 'Продовжити'}
              </button>
              <p className="text-sm text-center text-gray-500">
                Уже є акаунт? <Link to="/login" className="text-blue-600">Увійти</Link>
              </p>
            </form>
          )}

          {step === 1 && (
            <SalonInfoStep
              ownerEmail={ownerEmail}
              nameUk={nameUk}
              setNameUk={setNameUk}
              nameEn={nameEn}
              setNameEn={setNameEn}
              address={address}
              setAddress={setAddress}
              logoUrl={logoUrl}
              uploadLogo={uploadLogo}
              loading={loading}
              onNext={() => setStep(2)}
            />
          )}

          {step === 2 && (
            <BotStep
              rawBotToken={rawBotToken}
              setRawBotToken={setRawBotToken}
              botUsername={botUsername}
              verifyBot={verifyBot}
              loading={loading}
              onBack={() => setStep(1)}
              onNext={() => setStep(3)}
            />
          )}

          {step === 3 && (
            <NotificationsStep
              botUsername={botUsername}
              adminChatId={adminChatId}
              setAdminChatId={setAdminChatId}
              verifyChat={verifyChat}
              loading={loading}
              onBack={() => setStep(2)}
              onFinish={finish}
              canFinish={Boolean(onboardingToken && nameUk && rawBotToken && botUsername)}
            />
          )}

          {step === 4 && (
            <DoneStep
              botUsername={botUsername}
              email={ownerEmail}
              onAdmin={() => {
                window.location.href = '/';
              }}
            />
          )}
        </div>
      </div>
    </div>
  );
}

function SalonInfoStep({
  ownerEmail,
  nameUk,
  setNameUk,
  nameEn,
  setNameEn,
  address,
  setAddress,
  logoUrl,
  uploadLogo,
  loading,
  onNext,
}: {
  ownerEmail: string;
  nameUk: string;
  setNameUk: (value: string) => void;
  nameEn: string;
  setNameEn: (value: string) => void;
  address: string;
  setAddress: (value: string) => void;
  logoUrl: string;
  uploadLogo: (e: ChangeEvent<HTMLInputElement>) => void;
  loading: boolean;
  onNext: () => void;
}) {
  function submit(e: FormEvent) {
    e.preventDefault();
    onNext();
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <h2 className="text-xl font-semibold">Крок 1 — Інформація про салон</h2>
      <p className="text-sm text-gray-500">Власник: {ownerEmail}</p>
      <Input label="Назва (укр) *" value={nameUk} onChange={setNameUk} required />
      <Input label="Назва (англ)" value={nameEn} onChange={setNameEn} />
      <Input label="Адреса" value={address} onChange={setAddress} />
      <div>
        <div className="text-sm text-gray-600 mb-2">Логотип</div>
        <div className="flex flex-col items-start gap-2">
          {logoUrl ? (
            <img src={logoUrl} alt="" className="w-16 h-16 rounded-xl object-cover border" />
          ) : (
            <div className="w-16 h-16 rounded-xl bg-gray-100 border" />
          )}
          <label className="px-4 py-2 rounded-lg border cursor-pointer bg-white hover:bg-gray-50 text-sm">
            {loading ? 'Завантаження...' : 'Завантажити фото'}
            <input type="file" accept="image/*" onChange={uploadLogo} className="hidden" />
          </label>
        </div>
      </div>
      <button type="submit" disabled={!nameUk.trim()} className="w-full py-3 rounded-lg bg-blue-600 text-white font-medium disabled:opacity-60">
        Далі
      </button>
    </form>
  );
}

function BotStep({
  rawBotToken,
  setRawBotToken,
  botUsername,
  verifyBot,
  loading,
  onBack,
  onNext,
}: {
  rawBotToken: string;
  setRawBotToken: (value: string) => void;
  botUsername: string;
  verifyBot: () => Promise<void>;
  loading: boolean;
  onBack: () => void;
  onNext: () => void;
}) {
  return (
    <div className="space-y-4">
      <h2 className="text-xl font-semibold">Крок 2 — Telegram-бот салону</h2>
      <p className="text-sm text-gray-500">
        Створіть бота в @BotFather і вставте токен. Це бот для клієнтів салону, не логін адмінки.
      </p>
      <Input label="Токен бота *" value={rawBotToken} onChange={setRawBotToken} required />
      <button
        type="button"
        disabled={loading || !rawBotToken.trim()}
        onClick={() => void verifyBot()}
        className="px-4 py-2 rounded-lg border bg-white"
      >
        {loading ? 'Перевірка…' : 'Перевірити токен'}
      </button>
      {botUsername && <p className="text-sm text-green-700">Бот: @{botUsername}</p>}
      <div className="flex gap-2">
        <button type="button" onClick={onBack} className="flex-1 py-3 rounded-lg border">
          Назад
        </button>
        <button
          type="button"
          disabled={!botUsername}
          onClick={onNext}
          className="flex-1 py-3 rounded-lg bg-blue-600 text-white disabled:opacity-60"
        >
          Далі
        </button>
      </div>
    </div>
  );
}

function NotificationsStep({
  botUsername,
  adminChatId,
  setAdminChatId,
  verifyChat,
  loading,
  onBack,
  onFinish,
  canFinish,
}: {
  botUsername: string;
  adminChatId: string;
  setAdminChatId: (value: string) => void;
  verifyChat: () => Promise<void>;
  loading: boolean;
  onBack: () => void;
  onFinish: () => Promise<void>;
  canFinish: boolean;
}) {
  return (
    <div className="space-y-4">
      <h2 className="text-xl font-semibold">Крок 3 — Сповіщення</h2>
      <p className="text-sm text-gray-500">
        Додайте @{botUsername || 'бот'} у групу/чат і вставте chat_id (можна пропустити і налаштувати пізніше).
      </p>
      <Input label="Admin chat ID" value={adminChatId} onChange={setAdminChatId} />
      <button
        type="button"
        disabled={loading || !adminChatId.trim() || !botUsername}
        onClick={() => void verifyChat()}
        className="px-4 py-2 rounded-lg border bg-white"
      >
        {loading ? 'Надсилання…' : 'Надіслати тест'}
      </button>
      <div className="flex gap-2">
        <button type="button" onClick={onBack} className="flex-1 py-3 rounded-lg border">
          Назад
        </button>
        <button
          type="button"
          disabled={!canFinish || loading}
          onClick={() => void onFinish()}
          className="flex-1 py-3 rounded-lg bg-blue-600 text-white disabled:opacity-60"
        >
          {loading ? 'Створення…' : 'Завершити'}
        </button>
      </div>
    </div>
  );
}

function DoneStep({
  botUsername,
  email,
  onAdmin,
}: {
  botUsername: string;
  email: string;
  onAdmin: () => void;
}) {
  return (
    <div className="space-y-4 text-center">
      <h2 className="text-xl font-semibold">Салон підключено</h2>
      <p className="text-gray-600">
        Бот {botUsername ? `@${botUsername}` : 'готовий'}. Вхід в адмінку: <b>{email}</b>
      </p>
      <button type="button" onClick={onAdmin} className="w-full py-3 rounded-lg bg-blue-600 text-white font-medium">
        Перейти в адмінку
      </button>
    </div>
  );
}

function Input({
  label,
  value,
  onChange,
  type = 'text',
  required,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
  required?: boolean;
}) {
  return (
    <label className="block">
      <span className="text-sm text-gray-600">{label}</span>
      <input
        type={type}
        value={value}
        required={required}
        onChange={(e) => onChange(e.target.value)}
        className="w-full border rounded-lg p-3 mt-1"
      />
    </label>
  );
}
