import { FormEvent, useEffect, useState } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { clearSuperToken, getSuperToken, setSuperToken, superApi } from '../superApi';

type SalonRow = {
  id: string;
  name_uk: string;
  bot_username: string | null;
  is_active: boolean;
  created_at: string;
  staff_count: number;
  staff: { email: string; is_active: boolean }[];
};

type StaffRow = {
  id: string;
  email: string;
  full_name: string | null;
  role: string;
  is_active: boolean;
};

type ActivationCodeRow = {
  id: string;
  code: string;
  status: 'unused' | 'reserved' | 'redeemed' | 'revoked';
  reserved_email: string | null;
  redeemed_at: string | null;
  salon_id: string | null;
  note: string | null;
  created_at: string;
};

export function SuperLoginPage() {
  const navigate = useNavigate();
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (getSuperToken()) navigate('/super', { replace: true });
  }, [navigate]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError('');
    try {
      const { token } = await superApi<{ token: string }>('/api/super/login', {
        method: 'POST',
        body: JSON.stringify({ password }),
      });
      setSuperToken(token);
      navigate('/super', { replace: true });
    } catch (err) {
      setError((err as { error?: string }).error ?? 'Не вдалось увійти');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 p-4">
      <form onSubmit={submit} className="bg-white p-8 rounded-2xl border max-w-sm w-full space-y-4">
        <div>
          <h1 className="text-2xl font-bold">Super Admin</h1>
          <p className="text-sm text-gray-500 mt-1">Лише для власника платформи SalonBot</p>
        </div>
        {error && <div className="rounded-lg bg-red-50 border border-red-200 p-3 text-red-800 text-sm">{error}</div>}
        <label className="block">
          <span className="text-sm text-gray-600">Пароль</span>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            className="w-full border rounded-lg p-3 mt-1"
          />
        </label>
        <button type="submit" disabled={loading} className="w-full py-3 rounded-lg bg-blue-600 text-white font-medium">
          {loading ? 'Вхід…' : 'Увійти'}
        </button>
        <Link to="/login" className="block text-center text-sm text-blue-600">← До звичайного входу</Link>
      </form>
    </div>
  );
}

export function SuperAdminPage() {
  const navigate = useNavigate();
  const [salons, setSalons] = useState<SalonRow[]>([]);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(true);
  const [selectedSalonId, setSelectedSalonId] = useState<string | null>(null);
  const [staff, setStaff] = useState<StaffRow[]>([]);
  const [createdPasswords, setCreatedPasswords] = useState<
    { email: string; temporaryPassword: string; emailSent?: boolean; emailError?: string }[]
  >([]);

  const [form, setForm] = useState({
    name_uk: '',
    address: '',
    botToken: '',
    botUsername: '',
    adminChatId: '',
    staffEmails: '',
  });
  const [newStaffEmail, setNewStaffEmail] = useState('');
  const [saving, setSaving] = useState(false);
  const [activationCodes, setActivationCodes] = useState<ActivationCodeRow[]>([]);
  const [codeNote, setCodeNote] = useState('');
  const [codeCount, setCodeCount] = useState(1);
  const [lastCreatedCodes, setLastCreatedCodes] = useState<string[]>([]);

  async function loadSalons() {
    setLoading(true);
    setError('');
    try {
      const [salonRows, codeRows] = await Promise.all([
        superApi<SalonRow[]>('/api/super/salons'),
        superApi<ActivationCodeRow[]>('/api/super/activation-codes'),
      ]);
      setSalons(salonRows);
      setActivationCodes(codeRows);
    } catch (err) {
      setError((err as { error?: string }).error ?? 'Не вдалось завантажити салони');
      if ((err as { error?: string }).error === 'Unauthorized' || (err as { error?: string }).error === 'Super admin only') {
        clearSuperToken();
        navigate('/super/login', { replace: true });
      }
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!getSuperToken()) {
      navigate('/super/login', { replace: true });
      return;
    }
    void loadSalons();
  }, [navigate]);

  async function createActivationCodes(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError('');
    setMessage('');
    try {
      const result = await superApi<{ codes: ActivationCodeRow[] }>('/api/super/activation-codes', {
        method: 'POST',
        body: JSON.stringify({ note: codeNote || null, count: codeCount }),
      });
      const codes = result.codes.map((row) => row.code);
      setLastCreatedCodes(codes);
      setMessage(`Створено кодів: ${codes.length}. Клієнт активує на /onboarding`);
      setCodeNote('');
      setCodeCount(1);
      await loadSalons();
    } catch (err) {
      setError((err as { error?: string }).error ?? 'Не вдалось створити коди');
    } finally {
      setSaving(false);
    }
  }

  async function revokeCode(id: string) {
    setSaving(true);
    setError('');
    try {
      await superApi(`/api/super/activation-codes/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ revoke: true }),
      });
      setMessage('Код скасовано');
      await loadSalons();
    } catch (err) {
      setError((err as { error?: string }).error ?? 'Не вдалось скасувати код');
    } finally {
      setSaving(false);
    }
  }

  async function createSalon(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setMessage('');
    setError('');
    setCreatedPasswords([]);
    try {
      const staffEmails = form.staffEmails
        .split(/[\n,;]+/)
        .map((item) => item.trim())
        .filter(Boolean);
      const result = await superApi<{
        salon: SalonRow;
        staff: { email: string; temporaryPassword: string; emailSent?: boolean; emailError?: string }[];
      }>('/api/super/salons', {
        method: 'POST',
        body: JSON.stringify({
          name_uk: form.name_uk,
          address: form.address || null,
          botToken: form.botToken,
          botUsername: form.botUsername || null,
          adminChatId: form.adminChatId || null,
          staffEmails,
        }),
      });
      setCreatedPasswords(result.staff);
      const emailed = result.staff.filter((s) => s.emailSent).length;
      setMessage(
        emailed
          ? `Салон «${result.salon.name_uk}» створено. Паролі надіслано на ${emailed} email.`
          : `Салон «${result.salon.name_uk}» створено. Листи не пішли — скопіюй паролі нижче (перевір RESEND_API_KEY).`
      );
      setForm({ name_uk: '', address: '', botToken: '', botUsername: '', adminChatId: '', staffEmails: '' });
      await loadSalons();
    } catch (err) {
      setError((err as { error?: string }).error ?? 'Не вдалось створити салон');
    } finally {
      setSaving(false);
    }
  }

  async function openStaff(salonId: string) {
    setSelectedSalonId(salonId);
    setError('');
    try {
      setStaff(await superApi<StaffRow[]>(`/api/super/salons/${salonId}/staff`));
    } catch (err) {
      setError((err as { error?: string }).error ?? 'Не вдалось завантажити співробітників');
    }
  }

  async function addStaff(event: FormEvent) {
    event.preventDefault();
    if (!selectedSalonId || !newStaffEmail.trim()) return;
    setSaving(true);
    setError('');
    try {
      const created = await superApi<
        StaffRow & { temporaryPassword: string; emailSent?: boolean; emailError?: string }
      >(`/api/super/salons/${selectedSalonId}/staff`, {
        method: 'POST',
        body: JSON.stringify({ email: newStaffEmail }),
      });
      setCreatedPasswords((prev) => [
        ...prev,
        {
          email: created.email,
          temporaryPassword: created.temporaryPassword,
          emailSent: created.emailSent,
          emailError: created.emailError,
        },
      ]);
      setNewStaffEmail('');
      await openStaff(selectedSalonId);
      await loadSalons();
      setMessage(
        created.emailSent
          ? `Додано ${created.email}. Пароль надіслано на email.`
          : `Додано ${created.email}. Лист не пішов — пароль нижче.`
      );
    } catch (err) {
      setError((err as { error?: string }).error ?? 'Не вдалось додати співробітника');
    } finally {
      setSaving(false);
    }
  }

  async function resetPassword(staffId: string) {
    if (!selectedSalonId) return;
    try {
      const updated = await superApi<
        StaffRow & { temporaryPassword?: string; emailSent?: boolean; emailError?: string }
      >(`/api/super/salons/${selectedSalonId}/staff/${staffId}`, {
        method: 'PATCH',
        body: JSON.stringify({ resetPassword: true }),
      });
      if (updated.temporaryPassword) {
        setCreatedPasswords((prev) => [
          ...prev,
          {
            email: updated.email,
            temporaryPassword: updated.temporaryPassword!,
            emailSent: updated.emailSent,
            emailError: updated.emailError,
          },
        ]);
        setMessage(
          updated.emailSent
            ? `Новий пароль для ${updated.email} надіслано на email.`
            : `Новий пароль для ${updated.email} — нижче (лист не пішов).`
        );
      }
    } catch (err) {
      setError((err as { error?: string }).error ?? 'Не вдалось скинути пароль');
    }
  }

  async function deleteSalon(salon: SalonRow) {
    const ok = window.confirm(
      `Видалити салон «${salon.name_uk}» назавжди?\n\nБуде видалено співробітників, записи, майстрів і зупинено бота. Це незворотно.`
    );
    if (!ok) return;
    setSaving(true);
    setError('');
    setMessage('');
    try {
      await superApi(`/api/super/salons/${salon.id}`, { method: 'DELETE' });
      if (selectedSalonId === salon.id) {
        setSelectedSalonId(null);
        setStaff([]);
      }
      setMessage(`Салон «${salon.name_uk}» видалено.`);
      await loadSalons();
    } catch (err) {
      setError((err as { error?: string }).error ?? 'Не вдалось видалити салон');
    } finally {
      setSaving(false);
    }
  }

  if (!getSuperToken()) return <Navigate to="/super/login" replace />;

  return (
    <div className="min-h-screen bg-gray-50 p-4 md:p-8">
      <div className="max-w-5xl mx-auto space-y-6">
        <header className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold">Super Admin</h1>
            <p className="text-gray-500 text-sm mt-1">
              Коди активації (1 код = 1 салон) або ручне створення салону
            </p>
          </div>
          <div className="flex gap-2">
            <Link to="/login" className="px-3 py-2 rounded-lg border bg-white text-sm">Адмінка салону</Link>
            <button
              type="button"
              className="px-3 py-2 rounded-lg border bg-white text-sm"
              onClick={() => {
                clearSuperToken();
                navigate('/super/login');
              }}
            >
              Вийти
            </button>
          </div>
        </header>

        {message && <div className="rounded-xl bg-green-50 border border-green-200 p-3 text-green-800">{message}</div>}
        {error && <div className="rounded-xl bg-red-50 border border-red-200 p-3 text-red-800">{error}</div>}

        {!!createdPasswords.length && (
          <section className="rounded-2xl border border-amber-300 bg-amber-50 p-4 space-y-2">
            <h2 className="font-semibold">Доступи (email + запасний пароль)</h2>
            {createdPasswords.map((item) => (
              <div key={`${item.email}-${item.temporaryPassword}`} className="text-sm space-y-0.5">
                <div className="font-mono">
                  {item.email} → <b>{item.temporaryPassword}</b>
                </div>
                <div className={item.emailSent ? 'text-green-700' : 'text-amber-800'}>
                  {item.emailSent
                    ? 'Лист надіслано'
                    : `Лист не надіслано${item.emailError ? `: ${item.emailError}` : ''}`}
                </div>
              </div>
            ))}
          </section>
        )}

        <section className="bg-white border rounded-2xl p-5 space-y-4">
          <h2 className="text-xl font-bold">Коди активації</h2>
          <p className="text-sm text-gray-500">
            Клієнт заходить на <code>/onboarding</code>, вводить код + email + пароль і сам налаштовує 1 салон.
          </p>
          <form onSubmit={createActivationCodes} className="grid gap-3 md:grid-cols-3">
            <label className="block md:col-span-2">
              <span className="text-sm text-gray-600">Нотатка (салон / клієнт)</span>
              <input
                className="w-full border rounded-lg p-3 mt-1"
                value={codeNote}
                onChange={(e) => setCodeNote(e.target.value)}
                placeholder="Beauty Room, Марина"
              />
            </label>
            <label className="block">
              <span className="text-sm text-gray-600">Скільки кодів</span>
              <input
                type="number"
                min={1}
                max={20}
                className="w-full border rounded-lg p-3 mt-1"
                value={codeCount}
                onChange={(e) => setCodeCount(Number(e.target.value) || 1)}
              />
            </label>
            <button type="submit" disabled={saving} className="md:col-span-3 py-3 rounded-lg bg-emerald-600 text-white font-medium">
              {saving ? 'Створення…' : 'Згенерувати код(и)'}
            </button>
          </form>
          {!!lastCreatedCodes.length && (
            <div className="rounded-xl border border-emerald-300 bg-emerald-50 p-3 text-sm space-y-1">
              <div className="font-semibold">Нові коди (скинь клієнту):</div>
              {lastCreatedCodes.map((code) => (
                <div key={code} className="font-mono text-base">{code}</div>
              ))}
            </div>
          )}
          <div className="grid gap-2 max-h-72 overflow-auto">
            {activationCodes.map((row) => (
              <div key={row.id} className="border rounded-xl p-3 flex flex-wrap items-center justify-between gap-2">
                <div>
                  <div className="font-mono font-semibold">{row.code}</div>
                  <div className="text-sm text-gray-500">
                    {row.status}
                    {row.reserved_email ? ` · ${row.reserved_email}` : ''}
                    {row.note ? ` · ${row.note}` : ''}
                  </div>
                </div>
                {(row.status === 'unused' || row.status === 'reserved') && (
                  <button
                    type="button"
                    disabled={saving}
                    className="px-3 py-2 rounded-lg border text-sm"
                    onClick={() => void revokeCode(row.id)}
                  >
                    Скасувати
                  </button>
                )}
              </div>
            ))}
            {!activationCodes.length && !loading && (
              <div className="text-gray-500 text-sm">Кодів ще немає — згенеруй перший вище.</div>
            )}
          </div>
        </section>

        <section className="bg-white border rounded-2xl p-5 space-y-4">
          <h2 className="text-xl font-bold">Новий салон (вручну)</h2>
          <form onSubmit={createSalon} className="grid gap-3 md:grid-cols-2">
            <label className="block md:col-span-2">
              <span className="text-sm text-gray-600">Назва *</span>
              <input className="w-full border rounded-lg p-3 mt-1" required value={form.name_uk} onChange={(e) => setForm({ ...form, name_uk: e.target.value })} />
            </label>
            <label className="block md:col-span-2">
              <span className="text-sm text-gray-600">Адреса</span>
              <input className="w-full border rounded-lg p-3 mt-1" value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} />
            </label>
            <label className="block md:col-span-2">
              <span className="text-sm text-gray-600">Токен бота (BotFather) *</span>
              <input className="w-full border rounded-lg p-3 mt-1" required value={form.botToken} onChange={(e) => setForm({ ...form, botToken: e.target.value })} />
            </label>
            <label className="block">
              <span className="text-sm text-gray-600">Username бота</span>
              <input className="w-full border rounded-lg p-3 mt-1" placeholder="@SalonBot" value={form.botUsername} onChange={(e) => setForm({ ...form, botUsername: e.target.value })} />
            </label>
            <label className="block">
              <span className="text-sm text-gray-600">Admin chat ID</span>
              <input className="w-full border rounded-lg p-3 mt-1" value={form.adminChatId} onChange={(e) => setForm({ ...form, adminChatId: e.target.value })} />
            </label>
            <label className="block md:col-span-2">
              <span className="text-sm text-gray-600">Emails співробітників (по одному в рядку або через кому)</span>
              <textarea
                className="w-full border rounded-lg p-3 mt-1"
                rows={4}
                placeholder={'admin@clinic.com\nreception@clinic.com'}
                value={form.staffEmails}
                onChange={(e) => setForm({ ...form, staffEmails: e.target.value })}
              />
            </label>
            <button type="submit" disabled={saving} className="md:col-span-2 py-3 rounded-lg bg-blue-600 text-white font-medium">
              {saving ? 'Створення…' : 'Створити салон + доступи'}
            </button>
          </form>
        </section>

        <section className="bg-white border rounded-2xl p-5 space-y-3">
          <h2 className="text-xl font-bold">Салони {loading ? '…' : `(${salons.length})`}</h2>
          <div className="grid gap-2">
            {salons.map((salon) => (
              <div key={salon.id} className="border rounded-xl p-3 flex flex-wrap items-center gap-3 justify-between">
                <div>
                  <div className="font-semibold">{salon.name_uk}</div>
                  <div className="text-sm text-gray-500">
                    {salon.bot_username ? `@${salon.bot_username}` : 'без username'} · співробітників: {salon.staff_count} ·{' '}
                    {salon.is_active ? 'активний' : 'вимкнений'}
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button type="button" className="px-3 py-2 rounded-lg border" onClick={() => void openStaff(salon.id)}>
                    Співробітники
                  </button>
                  <button
                    type="button"
                    disabled={saving}
                    className="px-3 py-2 rounded-lg border border-red-200 text-red-700 bg-red-50"
                    onClick={() => void deleteSalon(salon)}
                  >
                    Видалити
                  </button>
                </div>
              </div>
            ))}
            {!salons.length && !loading && <div className="text-gray-500">Поки немає салонів.</div>}
          </div>
        </section>

        {selectedSalonId && (
          <section className="bg-white border rounded-2xl p-5 space-y-4">
            <h2 className="text-xl font-bold">Співробітники салону</h2>
            <form onSubmit={addStaff} className="flex flex-wrap gap-2">
              <input
                className="border rounded-lg p-3 flex-1 min-w-[220px]"
                placeholder="email@clinic.com"
                value={newStaffEmail}
                onChange={(e) => setNewStaffEmail(e.target.value)}
              />
              <button type="submit" disabled={saving} className="px-4 py-3 rounded-lg bg-blue-600 text-white">
                Додати
              </button>
            </form>
            <div className="grid gap-2">
              {staff.map((person) => (
                <div key={person.id} className="border rounded-xl p-3 flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <div className="font-medium">{person.email}</div>
                    <div className="text-sm text-gray-500">
                      {person.role} · {person.is_active ? 'активний' : 'вимкнений'}
                    </div>
                  </div>
                  <button type="button" className="px-3 py-2 rounded-lg border text-sm" onClick={() => void resetPassword(person.id)}>
                    Новий пароль
                  </button>
                </div>
              ))}
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
