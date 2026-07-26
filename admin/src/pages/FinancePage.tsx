import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import {
  FinanceEntryPayload,
  FinanceKind,
  FinanceListResponse,
  FinancePaymentMethod,
} from '../api';
import { Button, Input, Modal } from '../components/ui';
import { clearSuperToken, getSuperToken, superApi } from '../superApi';

type PeriodPreset = '7d' | '30d' | 'month' | 'custom';

type SalonOption = { id: string; name_uk: string };

type PlatformFinanceEntry = {
  id: string;
  entry_date: string;
  kind: FinanceKind;
  amount: number;
  currency: string;
  payment_method: FinancePaymentMethod;
  client_name: string | null;
  description: string;
  salon_id: string | null;
  salon_name: string | null;
  act_number: string | null;
  notes: string | null;
  created_at: string;
};

type PlatformPayload = Omit<FinanceEntryPayload, 'master_id' | 'booking_id'> & {
  salon_id?: string | null;
};

function toDateInput(value: Date) {
  const y = value.getFullYear();
  const m = String(value.getMonth() + 1).padStart(2, '0');
  const d = String(value.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function periodRange(preset: PeriodPreset, customFrom: string, customTo: string) {
  const now = new Date();
  if (preset === 'custom') {
    return {
      from: customFrom || toDateInput(new Date(now.getTime() - 30 * 86400000)),
      to: customTo || toDateInput(now),
    };
  }
  if (preset === '7d') {
    return { from: toDateInput(new Date(now.getTime() - 7 * 86400000)), to: toDateInput(now) };
  }
  if (preset === 'month') {
    return { from: toDateInput(new Date(now.getFullYear(), now.getMonth(), 1)), to: toDateInput(now) };
  }
  return { from: toDateInput(new Date(now.getTime() - 30 * 86400000)), to: toDateInput(now) };
}

function money(value: number) {
  return `${value.toLocaleString('uk-UA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ₴`;
}

function kindLabel(kind: FinanceKind) {
  return kind === 'income' ? 'Дохід' : 'Витрата';
}

function methodLabel(method: FinancePaymentMethod) {
  if (method === 'iban') return 'IBAN';
  if (method === 'cash') return 'Готівка';
  if (method === 'card') return 'Картка';
  return 'Інше';
}

function emptyForm(date: string): PlatformPayload {
  return {
    entry_date: date,
    kind: 'income',
    amount: 0,
    payment_method: 'iban',
    client_name: '',
    description: '',
    salon_id: null,
    act_number: '',
    notes: '',
  };
}

export function FinancePage() {
  const navigate = useNavigate();
  const [entries, setEntries] = useState<PlatformFinanceEntry[]>([]);
  const [summary, setSummary] = useState<FinanceListResponse['summary'] | null>(null);
  const [salons, setSalons] = useState<SalonOption[]>([]);
  const [search, setSearch] = useState('');
  const [periodPreset, setPeriodPreset] = useState<PeriodPreset>('month');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');
  const [kind, setKind] = useState<'all' | FinanceKind>('all');
  const [method, setMethod] = useState<'all' | FinancePaymentMethod>('all');
  const [salonId, setSalonId] = useState('all');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [draft, setDraft] = useState<PlatformPayload | null>(null);
  const [editId, setEditId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const range = useMemo(
    () => periodRange(periodPreset, customFrom, customTo),
    [periodPreset, customFrom, customTo]
  );

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams();
      params.set('from', range.from);
      params.set('to', range.to);
      if (search.trim()) params.set('search', search.trim());
      if (kind !== 'all') params.set('kind', kind);
      if (method !== 'all') params.set('method', method);
      if (salonId !== 'all') params.set('salonId', salonId);
      const data = await superApi<{ entries: PlatformFinanceEntry[]; summary: FinanceListResponse['summary'] }>(
        `/api/super/finance?${params}`
      );
      setEntries(data.entries);
      setSummary(data.summary);
    } catch (err) {
      setError((err as { error?: string }).error ?? 'Не вдалось завантажити облік');
      if ((err as { error?: string }).error === 'Unauthorized' || (err as { error?: string }).error === 'Super admin only') {
        clearSuperToken();
        navigate('/super/login', { replace: true });
      }
    } finally {
      setLoading(false);
    }
  }, [range.from, range.to, search, kind, method, salonId, navigate]);

  useEffect(() => {
    if (!getSuperToken()) {
      navigate('/super/login', { replace: true });
      return;
    }
    superApi<SalonOption[]>('/api/super/salons')
      .then((rows) => setSalons(rows.map((s) => ({ id: s.id, name_uk: s.name_uk }))))
      .catch(() => setSalons([]));
  }, [navigate]);

  useEffect(() => {
    if (!getSuperToken()) return;
    const timer = window.setTimeout(() => void load(), 200);
    return () => window.clearTimeout(timer);
  }, [load]);

  async function removeEntry(entry: PlatformFinanceEntry) {
    if (!confirm(`Видалити рядок «${entry.description || entry.client_name || entry.entry_date}»?`)) return;
    await superApi(`/api/super/finance/${entry.id}`, { method: 'DELETE' });
    await load();
  }

  async function saveEntry(event: FormEvent) {
    event.preventDefault();
    if (!draft) return;
    setSaving(true);
    setError('');
    try {
      const payload: PlatformPayload = {
        ...draft,
        amount: Number(draft.amount),
        client_name: draft.client_name || null,
        description: draft.description?.trim() || (draft.kind === 'income' ? 'Дохід' : 'Витрата'),
        salon_id: draft.salon_id || null,
        act_number: draft.act_number || null,
        notes: draft.notes || null,
      };
      if (editId) {
        await superApi(`/api/super/finance/${editId}`, {
          method: 'PATCH',
          body: JSON.stringify(payload),
        });
      } else {
        await superApi('/api/super/finance', {
          method: 'POST',
          body: JSON.stringify(payload),
        });
      }
      setDraft(null);
      setEditId(null);
      await load();
    } catch (err) {
      setError((err as { error?: string }).error ?? 'Не вдалось зберегти');
    } finally {
      setSaving(false);
    }
  }

  if (!getSuperToken()) return <Navigate to="/super/login" replace />;

  return (
    <div className="min-h-screen bg-gray-50 p-4 md:p-8">
      <div className="max-w-6xl mx-auto page-stack">
        <header className="page-header">
          <div>
            <span className="eyebrow">Твій ФОП</span>
            <h1>Облік платформи</h1>
            <p>Доходи від салонів, витрати (Railway тощо), IBAN, пошук і підсумки. Не видно клієнтам.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link to="/super" className="px-3 py-2 rounded-lg border bg-white text-sm">
              ← Super Admin
            </Link>
            <Button
              onClick={() => {
                setEditId(null);
                setDraft(emptyForm(range.to));
              }}
            >
              + Рядок
            </Button>
          </div>
        </header>

        <section className="content-card space-y-4">
          <div className="client-period-bar">
            <div className="client-period-presets">
              {(
                [
                  ['month', 'Цей місяць'],
                  ['7d', '7 днів'],
                  ['30d', '30 днів'],
                  ['custom', 'Свій період'],
                ] as const
              ).map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  className={`chip-btn${periodPreset === id ? ' active' : ''}`}
                  onClick={() => setPeriodPreset(id)}
                >
                  {label}
                </button>
              ))}
            </div>
            {periodPreset === 'custom' && (
              <div className="client-period-custom">
                <label>
                  Від
                  <Input type="date" value={customFrom || range.from} onChange={(e) => setCustomFrom(e.target.value)} />
                </label>
                <label>
                  До
                  <Input type="date" value={customTo || range.to} onChange={(e) => setCustomTo(e.target.value)} />
                </label>
              </div>
            )}
            {summary && (
              <div className="client-period-stats finance-stats">
                <span>
                  Дохід <strong>{money(summary.income_sum)}</strong>
                </span>
                <span>
                  Витрати <strong>{money(summary.expense_sum)}</strong>
                </span>
                <span>
                  Підсумок <strong>{money(summary.net)}</strong>
                </span>
                <span title="Орієнтовний єдиний податок 5% від доходу">
                  ЄП ~5% <strong>{money(summary.tax_5pct)}</strong>
                </span>
              </div>
            )}
          </div>

          <div className="finance-filters">
            <Input
              aria-label="Пошук"
              placeholder="Пошук: клієнт, опис, акт, салон…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <select value={kind} onChange={(e) => setKind(e.target.value as 'all' | FinanceKind)}>
              <option value="all">Усі типи</option>
              <option value="income">Дохід</option>
              <option value="expense">Витрата</option>
            </select>
            <select
              value={method}
              onChange={(e) => setMethod(e.target.value as 'all' | FinancePaymentMethod)}
            >
              <option value="all">Усі оплати</option>
              <option value="iban">IBAN</option>
              <option value="cash">Готівка</option>
              <option value="card">Картка</option>
              <option value="other">Інше</option>
            </select>
            <select value={salonId} onChange={(e) => setSalonId(e.target.value)}>
              <option value="all">Усі салони</option>
              {salons.map((salon) => (
                <option key={salon.id} value={salon.id}>
                  {salon.name_uk}
                </option>
              ))}
            </select>
          </div>
        </section>

        {error && <div className="notice-error">{error}</div>}
        {loading && <div className="notice">Завантаження…</div>}

        <div className="content-card finance-table-wrap">
          <table className="finance-table">
            <thead>
              <tr>
                <th>Дата</th>
                <th>Тип</th>
                <th>Клієнт / опис</th>
                <th>Салон</th>
                <th>Оплата</th>
                <th>Акт</th>
                <th className="num">Сума</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {entries.map((entry) => (
                <tr key={entry.id}>
                  <td>{entry.entry_date}</td>
                  <td>
                    <span className={`finance-kind ${entry.kind}`}>{kindLabel(entry.kind)}</span>
                  </td>
                  <td>
                    <b>{entry.client_name || '—'}</b>
                    <small>{entry.description}</small>
                    {entry.notes && <small className="muted">{entry.notes}</small>}
                  </td>
                  <td>{entry.salon_name || '—'}</td>
                  <td>{methodLabel(entry.payment_method)}</td>
                  <td>{entry.act_number || '—'}</td>
                  <td className={`num ${entry.kind === 'income' ? 'plus' : 'minus'}`}>
                    {entry.kind === 'expense' ? '−' : '+'}
                    {money(entry.amount)}
                  </td>
                  <td className="actions">
                    <button
                      type="button"
                      onClick={() => {
                        setEditId(entry.id);
                        setDraft({
                          entry_date: entry.entry_date,
                          kind: entry.kind,
                          amount: entry.amount,
                          payment_method: entry.payment_method,
                          client_name: entry.client_name ?? '',
                          description: entry.description,
                          salon_id: entry.salon_id,
                          act_number: entry.act_number ?? '',
                          notes: entry.notes ?? '',
                        });
                      }}
                    >
                      Змінити
                    </button>
                    <button type="button" className="danger" onClick={() => void removeEntry(entry)}>
                      Видалити
                    </button>
                  </td>
                </tr>
              ))}
              {!entries.length && !loading && (
                <tr>
                  <td colSpan={8} className="empty">
                    Поки немає рядків. Додай оплату від салону або витрату (хостинг тощо).
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {draft && (
          <Modal
            title={editId ? 'Змінити рядок' : 'Новий рядок обліку'}
            onClose={() => {
              setDraft(null);
              setEditId(null);
            }}
          >
            <form className="form-grid" onSubmit={saveEntry}>
              <label>
                Дата *
                <input
                  type="date"
                  required
                  value={draft.entry_date}
                  onChange={(e) => setDraft({ ...draft, entry_date: e.target.value })}
                />
              </label>
              <label>
                Тип *
                <select
                  value={draft.kind}
                  onChange={(e) => setDraft({ ...draft, kind: e.target.value as FinanceKind })}
                >
                  <option value="income">Дохід</option>
                  <option value="expense">Витрата</option>
                </select>
              </label>
              <label>
                Сума, ₴ *
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  required
                  value={draft.amount || ''}
                  onChange={(e) => setDraft({ ...draft, amount: Number(e.target.value) })}
                />
              </label>
              <label>
                Спосіб оплати
                <select
                  value={draft.payment_method}
                  onChange={(e) =>
                    setDraft({ ...draft, payment_method: e.target.value as FinancePaymentMethod })
                  }
                >
                  <option value="iban">IBAN</option>
                  <option value="cash">Готівка</option>
                  <option value="card">Картка</option>
                  <option value="other">Інше</option>
                </select>
              </label>
              <label className="full">
                Від кого / кому
                <input
                  value={draft.client_name ?? ''}
                  onChange={(e) => setDraft({ ...draft, client_name: e.target.value })}
                  placeholder="Салон «X», ФОП…"
                />
              </label>
              <label className="full">
                Опис
                <input
                  value={draft.description ?? ''}
                  onChange={(e) => setDraft({ ...draft, description: e.target.value })}
                  placeholder="Пілот 1500, Railway…"
                />
              </label>
              <label>
                Салон (опційно)
                <select
                  value={draft.salon_id ?? ''}
                  onChange={(e) => setDraft({ ...draft, salon_id: e.target.value || null })}
                >
                  <option value="">—</option>
                  {salons.map((salon) => (
                    <option key={salon.id} value={salon.id}>
                      {salon.name_uk}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                № акта
                <input
                  value={draft.act_number ?? ''}
                  onChange={(e) => setDraft({ ...draft, act_number: e.target.value })}
                />
              </label>
              <label className="full">
                Нотатки
                <textarea
                  rows={3}
                  value={draft.notes ?? ''}
                  onChange={(e) => setDraft({ ...draft, notes: e.target.value })}
                />
              </label>
              <Button className="full" type="submit" disabled={saving}>
                {saving ? 'Збереження…' : 'Зберегти'}
              </Button>
            </form>
          </Modal>
        )}
      </div>
    </div>
  );
}
