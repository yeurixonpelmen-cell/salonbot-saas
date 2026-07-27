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
  masters_total?: number;
  masters_active?: number;
  monthly_price_uah?: number;
};

type StaffRow = {
  id: string;
  email: string;
  full_name: string | null;
  role: string;
  is_active: boolean;
};

type MasterRow = {
  id: string;
  name: string;
  position: string | null;
  is_active: boolean;
  created_at: string;
};

type ActivationCodeRow = {
  id: string;
  code: string;
  status: 'unused' | 'reserved' | 'redeemed' | 'revoked';
  reserved_email: string | null;
  invite_email?: string | null;
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
  const [peopleTab, setPeopleTab] = useState<'staff' | 'masters'>('staff');
  const [staff, setStaff] = useState<StaffRow[]>([]);
  const [masters, setMasters] = useState<MasterRow[]>([]);
  const [peopleMeta, setPeopleMeta] = useState({ masters_active: 0, monthly_price_uah: 850 });
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
  const [inviteEmail, setInviteEmail] = useState('');
  const [lastInvite, setLastInvite] = useState<{ email: string; code: string; emailSent: boolean; emailError?: string } | null>(null);

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
    setLastInvite(null);
    try {
      const result = await superApi<{
        codes: ActivationCodeRow[];
        email: string;
        emailSent: boolean;
        emailSkipped?: boolean;
        emailError?: string;
      }>('/api/super/activation-codes', {
        method: 'POST',
        body: JSON.stringify({ email: inviteEmail }),
      });
      const code = result.codes[0]?.code ?? '';
      setLastInvite({
        email: result.email,
        code,
        emailSent: result.emailSent,
        emailError: result.emailError,
      });
      setMessage(
        result.emailSent
          ? `Код надіслано на ${result.email}`
          : `Код створено, але лист не пішов${result.emailError ? `: ${result.emailError}` : ''}. Перевір RESEND_API_KEY.`
      );
      setInviteEmail('');
      await loadSalons();
    } catch (err) {
      setError((err as { error?: string }).error ?? 'Не вдалось створити код');
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

  async function openSalonPeople(salonId: string, tab: 'staff' | 'masters' = 'staff') {
    setSelectedSalonId(salonId);
    setPeopleTab(tab);
    setError('');
    // Instant preview from list payload (emails already loaded with salons)
    const preview = salons.find((s) => s.id === salonId);
    if (preview?.staff?.length) {
      setStaff(
        preview.staff.map((row, index) => ({
          id: `preview-${index}`,
          email: row.email,
          full_name: null,
          role: 'staff',
          is_active: row.is_active,
        }))
      );
    }
    try {
      const people = await superApi<{
        staff: StaffRow[];
        masters: MasterRow[];
        masters_active: number;
        monthly_price_uah: number;
      }>(`/api/super/salons/${salonId}/people`);
      setStaff(people.staff);
      setMasters(people.masters);
      setPeopleMeta({
        masters_active: people.masters_active,
        monthly_price_uah: people.monthly_price_uah,
      });
    } catch (err) {
      setError((err as { error?: string }).error ?? 'Не вдалось завантажити людей салону');
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
      await openSalonPeople(selectedSalonId, 'staff');
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
        setMasters([]);
        setPeopleMeta({ masters_active: 0, monthly_price_uah: 850 });
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
              Вводиш email клієнта — код приходить йому на пошту. Салон далі налаштовує все сам.
            </p>
          </div>
          <div className="flex gap-2">
            <Link to="/super/finance" className="px-3 py-2 rounded-lg border bg-white text-sm font-medium">
              ФОП / каса
            </Link>
            <Link to="/login" className="px-3 py-2 rounded-lg border bg-white text-sm">Адмін-панель салону</Link>
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
            Введи email клієнта → система надішле код і посилання на <code>/onboarding</code>.
            Клієнт відкриває лист, вводить той самий email + пароль і сам налаштовує салон.
          </p>
          <form onSubmit={createActivationCodes} className="grid gap-3 md:grid-cols-3">
            <label className="block md:col-span-2">
              <span className="text-sm text-gray-600">Email клієнта *</span>
              <input
                type="email"
                required
                className="w-full border rounded-lg p-3 mt-1"
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
                placeholder="marina@clinic.com"
              />
            </label>
            <button type="submit" disabled={saving} className="md:col-span-1 py-3 rounded-lg bg-emerald-600 text-white font-medium self-end">
              {saving ? 'Надсилання…' : 'Надіслати код на email'}
            </button>
          </form>
          {lastInvite && (
            <div className="rounded-xl border border-emerald-300 bg-emerald-50 p-3 text-sm space-y-1">
              <div className="font-semibold">
                {lastInvite.emailSent ? 'Лист надіслано' : 'Код створено, лист не пішов'}
              </div>
              <div>
                Email: <b>{lastInvite.email}</b>
              </div>
              <div className="font-mono">Код (запасний): {lastInvite.code}</div>
              {!lastInvite.emailSent && lastInvite.emailError && (
                <div className="text-amber-800">{lastInvite.emailError}</div>
              )}
            </div>
          )}
          <div className="grid gap-2 max-h-72 overflow-auto">
            {activationCodes.map((row) => (
              <div key={row.id} className="border rounded-xl p-3 flex flex-wrap items-center justify-between gap-2">
                <div>
                  <div className="font-mono font-semibold">{row.code}</div>
                  <div className="text-sm text-gray-500">
                    {row.status}
                    {row.invite_email ? ` · надіслано: ${row.invite_email}` : ''}
                    {row.reserved_email ? ` · активує: ${row.reserved_email}` : ''}
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
              <div className="text-gray-500 text-sm">Кодів ще немає — надішли перший вище.</div>
            )}
          </div>
        </section>

        <details className="bg-white border rounded-2xl p-5">
          <summary className="cursor-pointer font-semibold text-gray-700">
            Розширене: створити салон вручну (зазвичай не треба)
          </summary>
          <p className="text-sm text-gray-500 mt-2 mb-4">
            Лише якщо сам налаштовуєш салон. Для клієнтів використовуй коди вище — токен і адресу вони вводять самі.
          </p>
          <form onSubmit={createSalon} className="grid gap-3 md:grid-cols-2">
            <label className="block md:col-span-2">
              <span className="text-sm text-gray-600">Назва *</span>
              <input className="w-full border rounded-lg p-3 mt-1" required value={form.name_uk} onChange={(e) => setForm({ ...form, name_uk: e.target.value })} />
            </label>
            <label className="block md:col-span-2">
              <span className="text-sm text-gray-600">Адреса (опційно)</span>
              <input className="w-full border rounded-lg p-3 mt-1" value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} />
            </label>
            <label className="block md:col-span-2">
              <span className="text-sm text-gray-600">Токен бота (BotFather) *</span>
              <input className="w-full border rounded-lg p-3 mt-1" required value={form.botToken} onChange={(e) => setForm({ ...form, botToken: e.target.value })} />
            </label>
            <label className="block">
              <span className="text-sm text-gray-600">Username бота (опційно)</span>
              <input className="w-full border rounded-lg p-3 mt-1" placeholder="@SalonBot" value={form.botUsername} onChange={(e) => setForm({ ...form, botUsername: e.target.value })} />
            </label>
            <label className="block">
              <span className="text-sm text-gray-600">Admin chat ID (опційно)</span>
              <input className="w-full border rounded-lg p-3 mt-1" value={form.adminChatId} onChange={(e) => setForm({ ...form, adminChatId: e.target.value })} />
            </label>
            <label className="block md:col-span-2">
              <span className="text-sm text-gray-600">Emails співробітників (якщо створюєш салон сам)</span>
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
        </details>

        <section className="bg-white border rounded-2xl p-5 space-y-3">
          <h2 className="text-xl font-bold">Салони {loading ? '…' : `(${salons.length})`}</h2>
          <p className="text-sm text-gray-500">
            Тариф: 850 грн до 5 активних спеціалістів у розкладі, далі +100 грн за кожного.
            Співробітники (email) на ціну не впливають.
          </p>
          <div className="grid gap-2">
            {salons.map((salon) => (
              <div key={salon.id} className="border rounded-xl p-3 flex flex-wrap items-center gap-3 justify-between">
                <div>
                  <div className="font-semibold">{salon.name_uk}</div>
                  <div className="text-sm text-gray-500">
                    {salon.bot_username ? `@${salon.bot_username}` : 'без username'} · логінів: {salon.staff_count}
                    {salon.staff?.length
                      ? ` (${salon.staff.map((s) => s.email).join(', ')})`
                      : ''}
                    {' · '}
                    спеціалістів: {salon.masters_active ?? 0}/{salon.masters_total ?? 0} активних · ~
                    {salon.monthly_price_uah ?? 850} грн/міс · {salon.is_active ? 'салон активний' : 'вимкнений'}
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    className="px-3 py-2 rounded-lg border"
                    onClick={() => void openSalonPeople(salon.id, 'staff')}
                  >
                    Співробітники
                  </button>
                  <button
                    type="button"
                    className="px-3 py-2 rounded-lg border"
                    onClick={() => void openSalonPeople(salon.id, 'masters')}
                  >
                    Спеціалісти
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
            <h2 className="text-xl font-bold">
              Люди салону
              {salons.find((s) => s.id === selectedSalonId)
                ? ` — ${salons.find((s) => s.id === selectedSalonId)!.name_uk}`
                : ''}
            </h2>
            <div className="rounded-xl bg-emerald-50 border border-emerald-200 p-3 text-sm text-emerald-900">
              Активних спеціалістів: <b>{peopleMeta.masters_active}</b>
              {' · '}
              орієнтовний тариф: <b>{peopleMeta.monthly_price_uah} грн/міс</b>
            </div>

            <div className="view-toggle" role="group" aria-label="Тип людей">
              <button
                type="button"
                className={peopleTab === 'staff' ? 'active' : ''}
                onClick={() => setPeopleTab('staff')}
              >
                Співробітники ({staff.length})
              </button>
              <button
                type="button"
                className={peopleTab === 'masters' ? 'active' : ''}
                onClick={() => setPeopleTab('masters')}
              >
                Спеціалісти ({masters.length})
              </button>
            </div>

            {peopleTab === 'staff' ? (
              <div className="space-y-2">
                <p className="text-sm text-gray-500">Email для входу в адмін-панель. На тариф не впливають.</p>
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
                          {person.role} · {person.is_active ? 'логін активний' : 'логін вимкнений'}
                        </div>
                      </div>
                      {!person.id.startsWith('preview-') && (
                        <button
                          type="button"
                          className="px-3 py-2 rounded-lg border text-sm"
                          onClick={() => void resetPassword(person.id)}
                        >
                          Новий пароль
                        </button>
                      )}
                    </div>
                  ))}
                  {!staff.length && <div className="text-sm text-gray-500">Поки немає логінів.</div>}
                </div>
              </div>
            ) : (
              <div className="space-y-2">
                <p className="text-sm text-gray-500">
                  Хто в розкладі / онлайн-записі. «Приймає записи» = активний у системі (впливає на тариф).
                </p>
                <div className="grid gap-2">
                  {masters.map((master) => (
                    <div key={master.id} className="border rounded-xl p-3 flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <div className="font-medium">{master.name}</div>
                        <div className="text-sm text-gray-500">{master.position || 'без посади'}</div>
                      </div>
                      <span
                        className={`text-sm font-medium px-3 py-1 rounded-full ${
                          master.is_active ? 'bg-emerald-100 text-emerald-800' : 'bg-gray-100 text-gray-600'
                        }`}
                      >
                        {master.is_active ? 'Приймає записи' : 'Не приймає'}
                      </span>
                    </div>
                  ))}
                  {!masters.length && (
                    <div className="text-sm text-gray-500">Спеціалістів ще немає — салон не додав у адмінці.</div>
                  )}
                </div>
              </div>
            )}
          </section>
        )}
      </div>
    </div>
  );
}
