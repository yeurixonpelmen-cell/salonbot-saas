import { FormEvent, ReactNode, useEffect, useState } from 'react';
import { api, Master, MasterPayload, MasterPortfolioItem, ScheduleRow } from '../api';
import { Button } from '../components/ui';

const DAYS = [
  { id: 1, label: 'Пн' },
  { id: 2, label: 'Вт' },
  { id: 3, label: 'Ср' },
  { id: 4, label: 'Чт' },
  { id: 5, label: 'Пт' },
  { id: 6, label: 'Сб' },
  { id: 7, label: 'Нд' },
];

type MasterDraft = MasterPayload & { id?: string };

function emptyDraft(): MasterDraft {
  return {
    name: '',
    position: '',
    photo_url: '',
    bio: '',
    portfolio: [],
    is_active: true,
  };
}

export function MastersPage() {
  const [masters, setMasters] = useState<Master[]>([]);
  const [draft, setDraft] = useState<MasterDraft | null>(null);
  const [scheduleMaster, setScheduleMaster] = useState<Master | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function load() {
    setLoading(true);
    setError('');
    try {
      setMasters(await api.get<Master[]>('/api/admin/masters'));
    } catch (err) {
      setError((err as { error?: string }).error ?? 'Не вдалось завантажити майстрів');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function remove(master: Master) {
    if (!confirm(`Видалити майстра ${master.name}?`)) return;
    await api.delete(`/api/admin/masters/${master.id}`);
    await load();
  }

  return (
    <div className="page-stack">
      <header className="page-header">
        <div>
          <span className="eyebrow">Команда</span>
          <h1>Спеціалісти</h1>
          <p>Графік, посада і портфоліо</p>
        </div>
        <Button onClick={() => setDraft(emptyDraft())}>+ Додати</Button>
      </header>

      {error && <div className="notice-error">{error}</div>}
      {loading && <div className="notice">Завантаження…</div>}

      <div className="grid gap-3">
        {masters.map((master) => (
          <div key={master.id} className="content-card flex gap-4 items-center">
            {master.photo_url ? (
              <img src={master.photo_url} alt="" className="w-16 h-16 rounded-xl object-cover" />
            ) : (
              <div className="large-initials" style={{ width: 64, height: 64, flex: '0 0 64px', fontSize: 18 }}>
                {(master.name || '?').slice(0, 1).toUpperCase()}
              </div>
            )}
            <div className="flex-1">
              <div className="font-semibold">{master.name}</div>
              <div className="text-sm text-gray-500">{master.position || 'Посада не вказана'}</div>
              <div className="text-sm mt-1">{master.is_active ? '✅ Активний' : '⛔ Неактивний'}</div>
              <div className="text-xs text-gray-400 mt-1">
                Портфоліо: {(master.portfolio ?? []).length ? `${master.portfolio.length} файл(ів)` : 'немає'}
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <button className="px-3 py-2 rounded-lg border" onClick={() => setScheduleMaster(master)}>
                Розклад
              </button>
              <button
                className="px-3 py-2 rounded-lg border"
                onClick={() =>
                  setDraft({
                    id: master.id,
                    name: master.name,
                    position: master.position ?? '',
                    photo_url: master.photo_url ?? '',
                    bio: master.bio ?? '',
                    portfolio: master.portfolio ?? [],
                    is_active: master.is_active,
                  })
                }
              >
                Змінити
              </button>
              <button className="px-3 py-2 rounded-lg border text-red-600" onClick={() => remove(master)}>
                Видалити
              </button>
            </div>
          </div>
        ))}
        {!masters.length && !loading && (
          <div className="bg-white border rounded-2xl p-6 text-gray-500">Поки немає майстрів.</div>
        )}
      </div>

      {draft && (
        <MasterForm
          draft={draft}
          onClose={() => setDraft(null)}
          onSaved={() => {
            setDraft(null);
            void load();
          }}
        />
      )}

      {scheduleMaster && (
        <ScheduleEditor master={scheduleMaster} onClose={() => setScheduleMaster(null)} />
      )}
    </div>
  );
}

function MasterForm({
  draft,
  onClose,
  onSaved,
}: {
  draft: MasterDraft;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState<MasterDraft>({
    ...draft,
    portfolio: draft.portfolio ?? [],
    bio: draft.bio ?? '',
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  function updatePortfolio(index: number, patch: Partial<MasterPortfolioItem>) {
    const portfolio = [...(form.portfolio ?? [])];
    portfolio[index] = { ...portfolio[index], ...patch };
    setForm({ ...form, portfolio });
  }

  function addPortfolioItem(type: 'photo' | 'video') {
    setForm({
      ...form,
      portfolio: [...(form.portfolio ?? []), { type, url: '', caption: '' }],
    });
  }

  function removePortfolioItem(index: number) {
    setForm({
      ...form,
      portfolio: (form.portfolio ?? []).filter((_, i) => i !== index),
    });
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      const payload: MasterPayload = {
        name: form.name,
        position: form.position || null,
        photo_url: form.photo_url || null,
        bio: form.bio || null,
        is_active: form.is_active,
        portfolio: (form.portfolio ?? [])
          .map((item) => ({
            type: item.type,
            url: item.url.trim(),
            ...(item.caption?.trim() ? { caption: item.caption.trim() } : {}),
          }))
          .filter((item) => item.url),
      };
      if (form.id) await api.patch(`/api/admin/masters/${form.id}`, payload);
      else await api.post('/api/admin/masters', payload);
      await onSaved();
    } catch (err) {
      setError((err as { error?: string }).error ?? 'Не вдалось зберегти майстра');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal title={form.id ? 'Змінити майстра' : 'Новий майстер'} onClose={onClose}>
      <form onSubmit={submit} className="space-y-3">
        {error && <div className="rounded-lg bg-red-50 border border-red-200 p-2 text-red-800 text-sm">{error}</div>}
        <Input label="Ім'я *" value={form.name} onChange={(name) => setForm({ ...form, name })} required />
        <Input label="Посада" value={form.position ?? ''} onChange={(position) => setForm({ ...form, position })} />
        <Input label="Фото URL" value={form.photo_url ?? ''} onChange={(photo_url) => setForm({ ...form, photo_url })} />
        <label className="block">
          <span className="text-sm text-gray-600">Про себе (необовʼязково)</span>
          <textarea
            value={form.bio ?? ''}
            onChange={(e) => setForm({ ...form, bio: e.target.value })}
            rows={3}
            placeholder="Коротко: досвід, стиль, спеціалізація…"
            className="w-full border rounded-lg p-3 mt-1"
          />
        </label>

        <div className="rounded-xl border bg-gray-50 p-3 space-y-3">
          <div>
            <div className="font-medium">Портфоліо (необовʼязково)</div>
            <p className="text-xs text-gray-500 mt-1">
              Додайте посилання на фото або відео робіт (прямі URL, Google Drive публічне, YouTube). Клієнт побачить це при виборі майстра.
            </p>
          </div>

          {(form.portfolio ?? []).map((item, index) => (
            <div key={index} className="bg-white border rounded-xl p-3 space-y-2">
              <div className="flex gap-2">
                <select
                  value={item.type}
                  onChange={(e) => updatePortfolio(index, { type: e.target.value as 'photo' | 'video' })}
                  className="border rounded-lg p-2"
                >
                  <option value="photo">Фото</option>
                  <option value="video">Відео</option>
                </select>
                <button
                  type="button"
                  className="ml-auto text-sm text-red-600"
                  onClick={() => removePortfolioItem(index)}
                >
                  Видалити
                </button>
              </div>
              <input
                value={item.url}
                onChange={(e) => updatePortfolio(index, { url: e.target.value })}
                placeholder={item.type === 'video' ? 'https://… відео' : 'https://… фото'}
                className="w-full border rounded-lg p-2"
              />
              <input
                value={item.caption ?? ''}
                onChange={(e) => updatePortfolio(index, { caption: e.target.value })}
                placeholder="Підпис (необовʼязково)"
                className="w-full border rounded-lg p-2"
              />
            </div>
          ))}

          <div className="flex flex-wrap gap-2">
            <button type="button" className="px-3 py-2 rounded-lg border bg-white" onClick={() => addPortfolioItem('photo')}>
              + Фото
            </button>
            <button type="button" className="px-3 py-2 rounded-lg border bg-white" onClick={() => addPortfolioItem('video')}>
              + Відео
            </button>
          </div>
        </div>

        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={form.is_active ?? true}
            onChange={(e) => setForm({ ...form, is_active: e.target.checked })}
          />
          Активний
        </label>
        <Button type="submit" disabled={saving} className="w-full">
          {saving ? 'Збереження...' : 'Зберегти'}
        </Button>
      </form>
    </Modal>
  );
}

function ScheduleEditor({ master, onClose }: { master: Master; onClose: () => void }) {
  const [rows, setRows] = useState<Record<number, ScheduleRow>>({});
  const [enabled, setEnabled] = useState<Record<number, boolean>>({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api.get<ScheduleRow[]>(`/api/admin/masters/${master.id}/schedule`).then((data) => {
      const nextRows: Record<number, ScheduleRow> = {};
      const nextEnabled: Record<number, boolean> = {};
      for (const day of DAYS) {
        const existing = data.find((r) => r.day_of_week === day.id);
        nextEnabled[day.id] = Boolean(existing);
        nextRows[day.id] = existing ?? {
          day_of_week: day.id,
          start_time: day.id === 7 ? '10:00' : '09:00',
          end_time: day.id === 7 ? '16:00' : '18:00',
        };
      }
      setRows(nextRows);
      setEnabled(nextEnabled);
    });
  }, [master.id]);

  async function save() {
    setSaving(true);
    try {
      const payload = DAYS.filter((d) => enabled[d.id]).map((d) => rows[d.id]);
      await api.put(`/api/admin/masters/${master.id}/schedule`, payload);
      onClose();
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal title={`Розклад: ${master.name}`} onClose={onClose}>
      <form
        className="space-y-3"
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        {DAYS.map((day) => (
          <div key={day.id} className="grid grid-cols-[60px_1fr_1fr] gap-2 items-center">
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={enabled[day.id] ?? false}
                onChange={(e) => setEnabled({ ...enabled, [day.id]: e.target.checked })}
              />
              {day.label}
            </label>
            <input
              type="time"
              disabled={!enabled[day.id]}
              value={rows[day.id]?.start_time?.slice(0, 5) ?? '09:00'}
              onChange={(e) =>
                setRows({ ...rows, [day.id]: { ...rows[day.id], day_of_week: day.id, start_time: e.target.value } })
              }
              className="border rounded-lg p-2 disabled:bg-gray-50"
            />
            <input
              type="time"
              disabled={!enabled[day.id]}
              value={rows[day.id]?.end_time?.slice(0, 5) ?? '18:00'}
              onChange={(e) =>
                setRows({ ...rows, [day.id]: { ...rows[day.id], day_of_week: day.id, end_time: e.target.value } })
              }
              className="border rounded-lg p-2 disabled:bg-gray-50"
            />
          </div>
        ))}
        <Button type="submit" disabled={saving} className="w-full">
          {saving ? 'Збереження...' : 'Зберегти розклад'}
        </Button>
      </form>
    </Modal>
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

function Modal({ title, children, onClose }: { title: string; children: ReactNode; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-end md:items-center justify-center p-0 md:p-4">
      <div className="bg-white w-full md:max-w-lg rounded-t-2xl md:rounded-2xl p-5 max-h-[90vh] overflow-auto">
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-xl font-bold">{title}</h2>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-900">
            Закрити
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
