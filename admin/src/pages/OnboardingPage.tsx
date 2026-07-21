import { ChangeEvent, FormEvent, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, setToken } from '../api';

const BOT_USERNAME = import.meta.env.VITE_LOGIN_BOT_USERNAME ?? 'salonbot_login_bot';

type Step = 0 | 1 | 2 | 3 | 4;

type Owner = {
  id: number;
  first_name?: string;
};

type TelegramAuthData = Record<string, string>;

export function OnboardingPage() {
  const navigate = useNavigate();
  const loginRef = useRef<HTMLDivElement>(null);
  const [step, setStep] = useState<Step>(0);
  const [ownerAuthData, setOwnerAuthData] = useState<TelegramAuthData | null>(() => {
    const raw = sessionStorage.getItem('onboarding_owner_auth');
    if (!raw) return null;
    try {
      return JSON.parse(raw) as TelegramAuthData;
    } catch {
      sessionStorage.removeItem('onboarding_owner_auth');
      return null;
    }
  });
  const [owner, setOwner] = useState<Owner | null>(() => {
    const id = sessionStorage.getItem('onboarding_owner_id');
    const firstName = sessionStorage.getItem('onboarding_first_name') ?? undefined;
    return id ? { id: Number(id), first_name: firstName } : null;
  });
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
    if (owner && step === 0) setStep(1);
  }, [owner, step]);

  useEffect(() => {
    if (step !== 0 || !loginRef.current) return;

    (window as unknown as { onOnboardingTelegramAuth?: (user: Record<string, string | number>) => void })
      .onOnboardingTelegramAuth = (user: Record<string, string | number>) => {
      const normalized: TelegramAuthData = Object.fromEntries(
        Object.entries(user).map(([key, value]) => [key, String(value)])
      );
      const nextOwner = { id: Number(normalized.id), first_name: normalized.first_name };
      sessionStorage.setItem('onboarding_owner_id', String(nextOwner.id));
      sessionStorage.setItem('onboarding_first_name', nextOwner.first_name ?? '');
      sessionStorage.setItem('onboarding_owner_auth', JSON.stringify(normalized));
      setOwnerAuthData(normalized);
      setOwner(nextOwner);
      setStep(1);
    };

    const script = document.createElement('script');
    script.src = 'https://telegram.org/js/telegram-widget.js?22';
    script.async = true;
    script.setAttribute('data-telegram-login', BOT_USERNAME);
    script.setAttribute('data-size', 'large');
    script.setAttribute('data-onauth', 'onOnboardingTelegramAuth(user)');
    script.setAttribute('data-request-access', 'write');
    loginRef.current.innerHTML = '';
    loginRef.current.appendChild(script);

    return () => {
      delete (window as unknown as { onOnboardingTelegramAuth?: (user: Record<string, string>) => void })
        .onOnboardingTelegramAuth;
      script.remove();
    };
  }, [step]);

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

  function clearOnboardingOwner() {
    sessionStorage.removeItem('onboarding_owner_id');
    sessionStorage.removeItem('onboarding_first_name');
    sessionStorage.removeItem('onboarding_owner_auth');
    setOwner(null);
    setOwnerAuthData(null);
  }

  async function finish() {
    if (!owner || !ownerAuthData) {
      clearOnboardingOwner();
      setError('Сесія Telegram відсутня. Увійдіть ще раз і завершіть підключення в цій вкладці.');
      setStep(0);
      return;
    }
    setLoading(true);
    setError('');
    try {
      const result = await api.post<{ salonId: string; token: string; botUsername: string }>(
        '/api/onboarding/complete',
        {
          ownerTelegramId: owner.id,
          ownerAuthData,
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
      clearOnboardingOwner();
      setStep(4);
    } catch (err) {
      const message = (err as { error?: string }).error ?? 'Не вдалось завершити онбординг';
      if (message.toLowerCase().includes('telegram login') || message.toLowerCase().includes('unauthorized')) {
        clearOnboardingOwner();
        setStep(0);
        setError('Сесія Telegram закінчилась. Увійдіть ще раз і одразу натисніть Завершити на кроці 3.');
      } else {
        setError(message);
      }
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
            <div className="text-center space-y-4">
              <h2 className="text-xl font-semibold">Крок 0 — Вхід</h2>
              <p className="text-gray-500">Увійдіть через Telegram, щоб прив'язати салон до власника.</p>
              <div ref={loginRef} className="flex justify-center" />
            </div>
          )}

          {step === 1 && (
            <SalonInfoStep
              owner={owner}
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
              canFinish={Boolean(owner && nameUk && rawBotToken && botUsername)}
            />
          )}

          {step === 4 && (
            <DoneStep botUsername={botUsername} onAdmin={() => navigate('/')} />
          )}
        </div>
      </div>
    </div>
  );
}

function SalonInfoStep({
  owner,
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
  owner: Owner | null;
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
      {owner && <p className="text-sm text-gray-500">Власник: {owner.first_name ?? owner.id}</p>}
      <Input label="Назва (укр) *" value={nameUk} onChange={setNameUk} required />
      <Input label="Назва (англ)" value={nameEn} onChange={setNameEn} />
      <Input label="Адреса" value={address} onChange={setAddress} />
      <div>
        <div className="text-sm text-gray-600 mb-2">Логотип</div>
        <div className="flex items-center gap-3">
          {logoUrl ? (
            <img src={logoUrl} alt="" className="w-16 h-16 rounded-xl object-cover border" />
          ) : (
            <div className="w-16 h-16 rounded-xl bg-gray-100 border flex items-center justify-center">📷</div>
          )}
          <label className="px-4 py-2 rounded-lg border cursor-pointer bg-white hover:bg-gray-50">
            {loading ? 'Завантаження...' : 'Завантажити фото'}
            <input type="file" accept="image/*" onChange={uploadLogo} className="hidden" />
          </label>
        </div>
      </div>
      <button className="w-full py-3 rounded-lg bg-blue-600 text-white font-medium">Далі</button>
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
  verifyBot: () => void;
  loading: boolean;
  onBack: () => void;
  onNext: () => void;
}) {
  return (
    <div className="space-y-4">
      <h2 className="text-xl font-semibold">Крок 2 — Налаштування Telegram бота</h2>
      <div className="rounded-xl bg-gray-50 border p-4 text-sm text-gray-600 space-y-1">
        <p>1. Відкрийте Telegram і знайдіть @BotFather</p>
        <p>2. Надішліть команду /newbot</p>
        <p>3. Введіть назву бота</p>
        <p>4. Введіть username, наприклад mysalon_bot</p>
        <p>5. Скопіюйте токен і вставте нижче</p>
      </div>
      <Input label="Токен бота *" value={rawBotToken} onChange={setRawBotToken} required />
      {botUsername && <p className="text-green-700">Бот @{botUsername} знайдено</p>}
      <div className="flex gap-2">
        <button type="button" onClick={onBack} className="px-4 py-3 rounded-lg border">
          Назад
        </button>
        <button type="button" onClick={verifyBot} disabled={loading || !rawBotToken} className="px-4 py-3 rounded-lg bg-gray-800 text-white disabled:opacity-50">
          Перевірити
        </button>
        <button type="button" onClick={onNext} disabled={!botUsername} className="flex-1 py-3 rounded-lg bg-blue-600 text-white disabled:opacity-50">
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
  verifyChat: () => void;
  loading: boolean;
  onBack: () => void;
  onFinish: () => void;
  canFinish: boolean;
}) {
  return (
    <div className="space-y-4">
      <h2 className="text-xl font-semibold">Крок 3 — Сповіщення</h2>
      <div className="rounded-xl bg-gray-50 border p-4 text-sm text-gray-600 space-y-1">
        <p>1. Створіть групу або канал в Telegram</p>
        <p>2. Додайте @{botUsername} як адміна</p>
        <p>3. Надішліть будь-яке повідомлення в групу/канал</p>
        <p>4. Вставте Chat ID нижче</p>
      </div>
      <Input label="Chat ID для сповіщень" value={adminChatId} onChange={setAdminChatId} />
      <div className="flex gap-2">
        <button type="button" onClick={onBack} className="px-4 py-3 rounded-lg border">
          Назад
        </button>
        <button type="button" onClick={verifyChat} disabled={loading || !adminChatId} className="px-4 py-3 rounded-lg bg-gray-800 text-white disabled:opacity-50">
          Перевірити
        </button>
        <button type="button" onClick={onFinish} disabled={loading || !canFinish} className="flex-1 py-3 rounded-lg bg-blue-600 text-white disabled:opacity-50">
          Завершити
        </button>
      </div>
    </div>
  );
}

function DoneStep({ botUsername, onAdmin }: { botUsername: string; onAdmin: () => void }) {
  const botUrl = `https://t.me/${botUsername}`;
  const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=${encodeURIComponent(botUrl)}`;

  return (
    <div className="text-center space-y-4">
      <div className="text-5xl">🎉</div>
      <h2 className="text-xl font-semibold">Ваш бот готовий!</h2>
      <a href={botUrl} target="_blank" rel="noreferrer" className="text-blue-600 hover:underline">
        t.me/{botUsername}
      </a>
      <div className="flex justify-center">
        <img src={qrUrl} alt="QR code" className="rounded-xl border" />
      </div>
      <button onClick={onAdmin} className="w-full py-3 rounded-lg bg-blue-600 text-white font-medium">
        Перейти в адмін панель →
      </button>
    </div>
  );
}

function Input({
  label,
  value,
  onChange,
  required,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  required?: boolean;
}) {
  return (
    <label className="block">
      <span className="text-sm text-gray-600">{label}</span>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        required={required}
        className="w-full border rounded-lg p-3 mt-1"
      />
    </label>
  );
}
