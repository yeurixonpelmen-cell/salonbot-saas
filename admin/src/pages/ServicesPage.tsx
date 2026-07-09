import { FormEvent, ReactNode, useEffect, useState } from 'react';
import { api, Master, Service, ServicePayload } from '../api';

type ServiceDraft = Partial<ServicePayload> & { id?: string };

export function ServicesPage() {
  const [services, setServices] = useState<Service[]>([]);
  const [masters, setMasters] = useState<Master[]>([]);
  const [draft, setDraft] = useState<ServiceDraft | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function load() {
    setLoading(true);
    setError('');
    try {
      const [servicesData, mastersData] = await Promise.all([
        api.get<Service[]>('/api/admin/services'),
        api.get<Master[]>('/api/admin/masters'),
      ]);
      setServices(servicesData);
      setMasters(mastersData);
    } catch (err) {
      setError((err as { error?: string }).error ?? 'Не вдалось завантажити послуги');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function remove(service: Service) {
    if (!confirm(`Видалити послугу "${service.name_uk}"?`)) return;
    await api.delete(`/api/admin/services/${service.id}`);
    await load();
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Послуги</h1>
          <p className="text-sm text-gray-500">Прайс, тривалість і прив'язка до майстрів</p>
        </div>
        <button
          className="px-4 py-2 rounded-lg bg-blue-600 text-white"
          onClick={() =>
            setDraft({
              name_uk: '',
              name_en: '',
              duration_minutes: 60,
              price: null,
              is_active: true,
              masterIds: [],
            })
          }
        >
          + Додати
        </button>
      </div>

      {error && <div className="rounded-xl bg-red-50 border border-red-200 p-3 text-red-800">{error}</div>}
      {loading && <div className="rounded-xl bg-white border p-3 text-gray-500">Завантаження...</div>}

      <div className="bg-white border rounded-2xl divide-y">
        {services.map((service) => (
          <div key={service.id} className="p-4 flex flex-col md:flex-row md:items-center gap-3">
            <div className="flex-1">
              <div className="font-semibold">✂️ {service.name_uk}</div>
              <div className="text-sm text-gray-500">
                {service.duration_minutes} хв{service.price ? ` • ${service.price} ₴` : ''}
              </div>
              <div className="text-sm text-gray-500">
                Майстри: {service.masters?.map((m) => m.name).join(', ') || 'не вибрано'}
              </div>
              <div className="text-sm mt-1">{service.is_active ? '✅ Активна' : '⛔ Неактивна'}</div>
            </div>
            <div className="flex gap-2">
              <button
                className="px-3 py-2 rounded-lg border"
                onClick={() =>
                  setDraft({
                    id: service.id,
                    name_uk: service.name_uk,
                    name_en: service.name_en,
                    duration_minutes: service.duration_minutes,
                    price: service.price,
                    is_active: service.is_active,
                    masterIds: service.masters?.map((m) => m.id) ?? [],
                  })
                }
              >
                Змінити
              </button>
              <button className="px-3 py-2 rounded-lg border text-red-600" onClick={() => remove(service)}>
                Видалити
              </button>
            </div>
          </div>
        ))}
        {!services.length && !loading && <div className="p-6 text-gray-500">Поки немає послуг.</div>}
      </div>

      {draft && (
        <ServiceForm
          draft={draft}
          masters={masters}
          onClose={() => setDraft(null)}
          onSaved={async () => {
            setDraft(null);
            await load();
          }}
        />
      )}
    </div>
  );
}

function ServiceForm({
  draft,
  masters,
  onClose,
  onSaved,
}: {
  draft: ServiceDraft;
  masters: Master[];
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const [form, setForm] = useState<ServiceDraft>(draft);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  function toggleMaster(masterId: string) {
    const current = form.masterIds ?? [];
    const next = current.includes(masterId)
      ? current.filter((id) => id !== masterId)
      : [...current, masterId];
    setForm({ ...form, masterIds: next });
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      const payload: ServicePayload = {
        name_uk: form.name_uk ?? '',
        name_en: form.name_en || null,
        duration_minutes: Number(form.duration_minutes ?? 60),
        price: form.price === null || form.price === undefined ? null : Number(form.price),
        is_active: form.is_active,
        masterIds: form.masterIds ?? [],
      };
      if (form.id) await api.patch(`/api/admin/services/${form.id}`, payload);
      else await api.post('/api/admin/services', payload);
      await onSaved();
    } catch (err) {
      setError((err as { error?: string }).error ?? 'Не вдалось зберегти послугу');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal title={form.id ? 'Змінити послугу' : 'Нова послуга'} onClose={onClose}>
      <form onSubmit={submit} className="space-y-3">
        {error && <div className="rounded-lg bg-red-50 border border-red-200 p-2 text-red-800 text-sm">{error}</div>}
        <Input label="Назва українською *" value={form.name_uk ?? ''} onChange={(name_uk) => setForm({ ...form, name_uk })} required />
        <Input label="Назва англійською" value={form.name_en ?? ''} onChange={(name_en) => setForm({ ...form, name_en })} />
        <Input
          label="Тривалість, хв *"
          type="number"
          value={String(form.duration_minutes ?? 60)}
          onChange={(duration_minutes) => setForm({ ...form, duration_minutes: Number(duration_minutes) })}
          required
        />
        <Input
          label="Ціна, грн"
          type="number"
          value={form.price === null || form.price === undefined ? '' : String(form.price)}
          onChange={(price) => setForm({ ...form, price: price ? Number(price) : null })}
        />
        <div>
          <div className="text-sm text-gray-600 mb-2">Майстри</div>
          <div className="grid gap-2">
            {masters.map((master) => (
              <label key={master.id} className="flex items-center gap-2 border rounded-lg p-2">
                <input
                  type="checkbox"
                  checked={(form.masterIds ?? []).includes(master.id)}
                  onChange={() => toggleMaster(master.id)}
                />
                {master.name}
              </label>
            ))}
          </div>
        </div>
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={form.is_active ?? true}
            onChange={(e) => setForm({ ...form, is_active: e.target.checked })}
          />
          Активна
        </label>
        <button disabled={saving} className="w-full py-3 rounded-lg bg-blue-600 text-white font-medium">
          {saving ? 'Збереження...' : 'Зберегти'}
        </button>
      </form>
    </Modal>
  );
}

function Input({
  label,
  value,
  onChange,
  required,
  type = 'text',
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  required?: boolean;
  type?: string;
}) {
  return (
    <label className="block">
      <span className="text-sm text-gray-600">{label}</span>
      <input
        type={type}
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
