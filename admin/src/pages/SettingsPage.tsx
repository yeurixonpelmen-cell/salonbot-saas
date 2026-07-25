import { ChangeEvent, FormEvent, useEffect, useState } from 'react';
import { api, SalonSettings } from '../api';
import { Button } from '../components/ui';
import { useLocale } from '../context/LocaleContext';
import { AdminLang } from '../i18n/locales';
import { AdminTheme, applyAdminTheme, getAdminTheme } from '../utils/theme';

export function SettingsPage() {
  const { t, lang, setLang } = useLocale();
  const [settings, setSettings] = useState<SalonSettings | null>(null);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [theme, setTheme] = useState<AdminTheme>(() => getAdminTheme());

  async function load() {
    setError('');
    try {
      setSettings(await api.get<SalonSettings>('/api/admin/salon'));
    } catch (err) {
      setError((err as { error?: string }).error ?? t('settings_load_error'));
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function toggleDarkBackground(enabled: boolean) {
    const next: AdminTheme = enabled ? 'dark' : 'light';
    setTheme(next);
    applyAdminTheme(next);
  }

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
        language: settings.language ?? 'uk',
        reminders_enabled: settings.reminders_enabled ?? true,
        review_request_enabled: settings.review_request_enabled ?? false,
        google_maps_url: settings.google_maps_url ?? null,
      });
      setSettings(saved);
      setMessage(t('settings_saved'));
    } catch (err) {
      setError((err as { error?: string }).error ?? t('settings_save_error'));
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
      setMessage(t('settings_logo_ok'));
    } catch (err) {
      setError((err as { error?: string }).error ?? t('settings_save_error'));
    } finally {
      setUploading(false);
    }
  }

  if (!settings) {
    return (
      <div className="content-card">
        {error ? <p className="text-red-700">{error}</p> : <p className="text-gray-500">{t('settings_loading')}</p>}
      </div>
    );
  }

  const botLang = settings.language ?? 'uk';

  return (
    <div className="max-w-2xl space-y-4">
      <div>
        <h1 className="text-2xl font-bold">{t('settings_title')}</h1>
        <p className="text-sm text-gray-500 settings-muted">{t('settings_sub')}</p>
      </div>

      {message && <div className="rounded-xl bg-green-50 border border-green-200 p-3 text-green-800">{message}</div>}
      {error && <div className="rounded-xl bg-red-50 border border-red-200 p-3 text-red-800">{error}</div>}

      <form onSubmit={submit} className="bg-white border rounded-2xl p-5 space-y-4 settings-card">
        <Input
          label={t('settings_name_uk')}
          value={settings.name_uk}
          onChange={(name_uk) => setSettings({ ...settings, name_uk })}
          required
        />
        <Input
          label={t('settings_name_en')}
          value={settings.name_en ?? ''}
          onChange={(name_en) => setSettings({ ...settings, name_en })}
        />
        <Input
          label={t('settings_address')}
          value={settings.address ?? ''}
          onChange={(address) => setSettings({ ...settings, address })}
        />

        <div>
          <div className="text-sm text-gray-600 mb-2 settings-muted">{t('settings_logo')}</div>
          <div className="flex items-center gap-3">
            {settings.logo_url ? (
              <img src={settings.logo_url} alt="" className="w-16 h-16 rounded-xl object-cover border" />
            ) : (
              <div className="w-16 h-16 rounded-xl bg-gray-100 border flex items-center justify-center">📷</div>
            )}
            <label className="px-4 py-2 rounded-lg border cursor-pointer bg-white hover:bg-gray-50">
              {uploading ? t('settings_uploading') : t('settings_upload')}
              <input type="file" accept="image/*" onChange={uploadLogo} className="hidden" />
            </label>
          </div>
        </div>

        <div className="border-t pt-4">
          <h2 className="font-semibold mb-3">{t('settings_telegram')}</h2>
          <div className="rounded-xl bg-gray-50 border p-3 text-sm text-gray-600 mb-3">{t('settings_token_hint')}</div>
          <Input
            label={t('settings_bot_username')}
            value={settings.bot_username ? `@${settings.bot_username}` : t('settings_not_set')}
            disabled
          />
          <Input
            label={t('settings_chat_id')}
            value={settings.admin_chat_id ?? ''}
            onChange={(admin_chat_id) => setSettings({ ...settings, admin_chat_id })}
          />
          <p className="text-sm text-gray-500 settings-muted">{t('settings_chat_hint')}</p>
        </div>

        <div className="border-t pt-4 space-y-4">
          <div>
            <h2 className="font-semibold">{t('settings_auto')}</h2>
            <p className="text-sm text-gray-500 mt-1 settings-muted">{t('settings_auto_sub')}</p>
          </div>

          <div
            className="rounded-xl border p-3 text-sm"
            style={{ background: 'var(--accent-soft)', borderColor: 'var(--line)', color: 'var(--accent-ink)' }}
          >
            <b>{t('settings_link_title')}</b>
            <div className="mt-2 break-all font-mono text-xs">
              {`https://salonbot-mini-app-production.up.railway.app/?salon=${settings.id}`}
            </div>
            <p className="mt-2 opacity-80">{t('settings_link_hint')}</p>
          </div>

          <label className="flex items-start gap-3 rounded-xl border p-3 cursor-pointer hover:bg-gray-50">
            <input
              type="checkbox"
              className="mt-1"
              checked={settings.reminders_enabled ?? true}
              onChange={(e) => setSettings({ ...settings, reminders_enabled: e.target.checked })}
            />
            <span>
              <span className="font-medium block">{t('settings_reminders')}</span>
              <span className="text-sm text-gray-500 settings-muted">{t('settings_reminders_sub')}</span>
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
              <span className="font-medium block">{t('settings_review')}</span>
              <span className="text-sm text-gray-500 settings-muted">{t('settings_review_sub')}</span>
            </span>
          </label>

          {(settings.review_request_enabled ?? false) && (
            <div>
              <Input
                label={t('settings_maps')}
                value={settings.google_maps_url ?? ''}
                onChange={(google_maps_url) => setSettings({ ...settings, google_maps_url })}
                placeholder="https://maps.google.com/..."
              />
              <p className="text-sm text-gray-500 mt-1 settings-muted">{t('settings_maps_hint')}</p>
            </div>
          )}
        </div>

        <label className="flex items-start gap-3 rounded-xl border p-3 cursor-pointer hover:bg-gray-50">
          <input
            type="checkbox"
            className="mt-1"
            checked={theme === 'dark'}
            onChange={(e) => toggleDarkBackground(e.target.checked)}
          />
          <span>
            <span className="font-medium block">{t('settings_dark')}</span>
            <span className="text-sm text-gray-500 settings-muted">{t('settings_dark_sub')}</span>
          </span>
        </label>

        <div className="border-t pt-4 space-y-5">
          <div className="space-y-2">
            <div>
              <div className="font-semibold">{t('settings_lang_admin')}</div>
              <p className="text-sm text-gray-500 settings-muted">{t('settings_lang_admin_sub')}</p>
            </div>
            <div className="client-period-presets">
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
                  onClick={() => setLang(code as AdminLang)}
                >
                  {t(key)}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-2">
            <div>
              <div className="font-semibold">{t('settings_lang_bot')}</div>
              <p className="text-sm text-gray-500 settings-muted">{t('settings_lang_bot_sub')}</p>
            </div>
            <div className="client-period-presets">
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
                  className={`chip-btn${botLang === code ? ' active' : ''}`}
                  onClick={() =>
                    setSettings({
                      ...settings,
                      language: code as SalonSettings['language'],
                    })
                  }
                >
                  {t(key)}
                </button>
              ))}
            </div>
          </div>
        </div>

        <Button type="submit" disabled={saving} className="w-full">
          {saving ? t('settings_saving') : t('settings_save')}
        </Button>
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
      <span className="text-sm text-gray-600 settings-muted">{label}</span>
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
