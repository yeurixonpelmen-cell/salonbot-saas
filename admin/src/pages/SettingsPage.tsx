import { ChangeEvent, FormEvent, useEffect, useState } from 'react';
import { api, SalonSettings } from '../api';

export function SettingsPage() {
  const [settings, setSettings] = useState<SalonSettings | null>(null);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  async function load() {
    setError('');
    try {
      setSettings(await api.get<SalonSettings>('/api/admin/salon'));
    } catch (err) {
      setError((err as { error?: string }).error ?? 'Не вдалось завантажити налаштування');
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!settings) return;
    setSaving(true);
    setMessage('');
    setError('');
    try {
      const saved = await api.patch<SalonSettings>('/api/admin/salon', {
        name_uk: settings.name_uk,
        name_en: settings.name_en,
        address: settings.address,
        logo_url: settings.logo_url,
        admin_chat_id: settings.admin_chat_id,
        reminders_enabled: settings.reminders_enabled ?? true,
        review_request_enabled: settings.review_request_enabled ?? false,
        google_maps_url: settings.google_maps_url ?? null,
      });
      setSettings(saved);
      setMessage('Налаштування збережено');
    } catch (err) {
      setError((err as { error?: string }).error ?? 'Не вдалось зберегти налаштування');
    } finally {
      setSaving(false);
    }
  }

  async function uploadLogo(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    const form = new FormData();
    form.append('logo', file);
    setUploading(true);
    setError('');
    try {
      const { url } = await api.post<{ url: string }>('/api/admin/salon/logo', form);
      setSettings((s) => (s ? { ...s, logo_url: url } : s));
      setMessage('Логотип завантажено. Натисніть "Зберегти налаштування".');
    } catch (err) {
      setError((err as { error?: string }).error ?? 'Не вдалось завантажити логотип');
    } finally {
      setUploading(false);
    }
  }

  if (!settings) {
    return (
      <div className="bg-white border rounded-2xl p-6">
        {error ? <p className="text-red-700">{error}</p> : <p className="text-gray-500">Завантаження...</p>}
      </div>
    );
  }

  return (
    <div className="max-w-2xl space-y-4">
      <div>
        <h1 className="text-2xl font-bold">Налаштування</h1>
        <p className="text-sm text-gray-500">Дані салону, логотип і Telegram-сповіщення</p>
      </div>

      {message && <div className="rounded-xl bg-green-50 border border-green-200 p-3 text-green-800">{message}</div>}
      {error && <div className="rounded-xl bg-red-50 border border-red-200 p-3 text-red-800">{error}</div>}

      <form onSubmit={submit} className="bg-white border rounded-2xl p-5 space-y-4">
        <Input
          label="Назва салону (укр) *"
          value={settings.name_uk}
          onChange={(name_uk) => setSettings({ ...settings, name_uk })}
          required
        />
        <Input
          label="Назва салону (англ)"
          value={settings.name_en ?? ''}
          onChange={(name_en) => setSettings({ ...settings, name_en })}
        />
        <Input
          label="Адреса"
          value={settings.address ?? ''}
          onChange={(address) => setSettings({ ...settings, address })}
        />

        <div>
          <div className="text-sm text-gray-600 mb-2">Логотип салону</div>
          <div className="flex items-center gap-3">
            {settings.logo_url ? (
              <img src={settings.logo_url} alt="" className="w-16 h-16 rounded-xl object-cover border" />
            ) : (
              <div className="w-16 h-16 rounded-xl bg-gray-100 border flex items-center justify-center">📷</div>
            )}
            <label className="px-4 py-2 rounded-lg border cursor-pointer bg-white hover:bg-gray-50">
              {uploading ? 'Завантаження...' : 'Завантажити фото'}
              <input type="file" accept="image/*" onChange={uploadLogo} className="hidden" />
            </label>
          </div>
        </div>

        <div className="border-t pt-4">
          <h2 className="font-semibold mb-3">Telegram бот</h2>
          <div className="rounded-xl bg-gray-50 border p-3 text-sm text-gray-600 mb-3">
            Токен бота не показується в адмінці з міркувань безпеки. Його зміна буде в онбордингу або окремому security-flow.
          </div>
          <Input label="Username бота" value={settings.bot_username ? `@${settings.bot_username}` : 'Не налаштовано'} disabled />
          <Input
            label="Chat ID для сповіщень"
            value={settings.admin_chat_id ?? ''}
            onChange={(admin_chat_id) => setSettings({ ...settings, admin_chat_id })}
          />
          <p className="text-sm text-gray-500">
            Додайте бота в Telegram-групу або канал як адміна, потім вставте chat_id.
          </p>
        </div>

        <div className="border-t pt-4 space-y-4">
          <div>
            <h2 className="font-semibold">Автоповідомлення клієнтам</h2>
            <p className="text-sm text-gray-500 mt-1">Увімкніть те, що потрібно саме вашому салону</p>
          </div>

          <div className="rounded-xl bg-blue-50 border border-blue-100 p-3 text-sm text-blue-900">
            <b>Посилання для Instagram / Viber (без Telegram):</b>
            <div className="mt-2 break-all font-mono text-xs">
              {`https://salonbot-mini-app-production.up.railway.app/?salon=${settings.id}`}
            </div>
            <p className="mt-2 text-blue-800/80">Кидайте це посилання клієнтам — відкриється той самий запис у браузері.</p>
          </div>

          <label className="flex items-start gap-3 rounded-xl border p-3 cursor-pointer hover:bg-gray-50">
            <input
              type="checkbox"
              className="mt-1"
              checked={settings.reminders_enabled ?? true}
              onChange={(e) => setSettings({ ...settings, reminders_enabled: e.target.checked })}
            />
            <span>
              <span className="font-medium block">Нагадування про запис</span>
              <span className="text-sm text-gray-500">Бот напише клієнту за 24 години і за 2 години до візиту</span>
            </span>
          </label>

          <label className="flex items-start gap-3 rounded-xl border p-3 cursor-pointer hover:bg-gray-50">
            <input
              type="checkbox"
              className="mt-1"
              checked={settings.review_request_enabled ?? false}
              onChange={(e) => setSettings({ ...settings, review_request_enabled: e.target.checked })}
            />
            <span>
              <span className="font-medium block">Прохання залишити відгук</span>
              <span className="text-sm text-gray-500">
                Через ~1–4 години після закінчення візиту бот надішле посилання на Google Maps
              </span>
            </span>
          </label>

          {(settings.review_request_enabled ?? false) && (
            <div>
              <Input
                label="Посилання Google Maps / відгук *"
                value={settings.google_maps_url ?? ''}
                onChange={(google_maps_url) => setSettings({ ...settings, google_maps_url })}
                placeholder="https://maps.google.com/..."
              />
              <p className="text-sm text-gray-500 mt-1">
                Відкрийте свій заклад у Google Maps → «Поділитися» або «Написати відгук» → скопіюйте посилання.
              </p>
            </div>
          )}
        </div>

        <button type="submit" disabled={saving} className="w-full py-3 rounded-lg bg-blue-600 text-white font-medium">
          {saving ? 'Збереження...' : 'Зберегти налаштування'}
        </button>
      </form>
    </div>
  );
}

function Input({
  label,
  value,
  onChange,
  required,
  disabled,
  placeholder,
}: {
  label: string;
  value: string;
  onChange?: (value: string) => void;
  required?: boolean;
  disabled?: boolean;
  placeholder?: string;
}) {
  return (
    <label className="block">
      <span className="text-sm text-gray-600">{label}</span>
      <input
        value={value}
        onChange={(e) => onChange?.(e.target.value)}
        required={required}
        disabled={disabled}
        placeholder={placeholder}
        className="w-full border rounded-lg p-3 mt-1 disabled:bg-gray-50"
      />
    </label>
  );
}
