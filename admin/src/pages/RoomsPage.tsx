import { FormEvent, useEffect, useState } from 'react';
import { api, Room, RoomPayload } from '../api';

type RoomDraft = RoomPayload & { id?: string };

function emptyDraft(): RoomDraft {
  return { name: '', sort_order: 0, is_active: true };
}

export function RoomsPage() {
  const [rooms, setRooms] = useState<Room[]>([]);
  const [draft, setDraft] = useState<RoomDraft | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function load() {
    setLoading(true);
    setError('');
    try {
      setRooms(await api.get<Room[]>('/api/admin/rooms'));
    } catch (err) {
      setError((err as { error?: string }).error ?? 'Не вдалось завантажити кабінети');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function remove(room: Room) {
    if (!confirm(`Вимкнути кабінет «${room.name}»?`)) return;
    await api.delete(`/api/admin/rooms/${room.id}`);
    void load();
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold">Кабінети</h1>
          <p className="text-sm text-gray-500">Для клінік: розклад можна дивитись по кабінетах</p>
        </div>
        <button className="px-4 py-2 rounded-lg bg-blue-600 text-white" onClick={() => setDraft(emptyDraft())}>
          + Додати
        </button>
      </div>

      {error && <div className="rounded-xl bg-red-50 border border-red-200 p-3 text-red-800">{error}</div>}
      {loading && <div className="rounded-xl bg-white border p-3 text-gray-500">Завантаження...</div>}

      <div className="bg-white border rounded-2xl divide-y">
        {rooms.map((room) => (
          <div key={room.id} className="p-4 flex flex-col md:flex-row md:items-center gap-3">
            <div className="flex-1">
              <div className="font-semibold">{room.name}</div>
              <div className="text-sm text-gray-500">Порядок: {room.sort_order}</div>
              <div className="text-sm mt-1">{room.is_active ? '✅ Активний' : '⛔ Вимкнений'}</div>
            </div>
            <div className="flex gap-2">
              <button
                className="px-3 py-2 rounded-lg border"
                onClick={() =>
                  setDraft({
                    id: room.id,
                    name: room.name,
                    sort_order: room.sort_order,
                    is_active: room.is_active,
                  })
                }
              >
                Змінити
              </button>
              {room.is_active && (
                <button className="px-3 py-2 rounded-lg border text-red-600" onClick={() => void remove(room)}>
                  Вимкнути
                </button>
              )}
            </div>
          </div>
        ))}
        {!rooms.length && !loading && (
          <div className="p-6 text-gray-500">Поки немає кабінетів. Додайте — і на Розкладі з’явиться перемикач «Кабінети».</div>
        )}
      </div>

      {draft && (
        <RoomForm
          draft={draft}
          onClose={() => setDraft(null)}
          onSaved={() => {
            setDraft(null);
            void load();
          }}
        />
      )}
    </div>
  );
}

function RoomForm({
  draft,
  onClose,
  onSaved,
}: {
  draft: RoomDraft;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState<RoomDraft>(draft);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  async function submit(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError('');
    try {
      const payload: RoomPayload = {
        name: form.name.trim(),
        sort_order: Number(form.sort_order) || 0,
        is_active: form.is_active !== false,
      };
      if (!payload.name) {
        setError('Вкажіть назву кабінету');
        return;
      }
      if (form.id) await api.patch(`/api/admin/rooms/${form.id}`, payload);
      else await api.post('/api/admin/rooms', payload);
      onSaved();
    } catch (err) {
      setError((err as { error?: string }).error ?? 'Не вдалось зберегти кабінет');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={onClose}>
      <form
        className="bg-white rounded-2xl border w-full max-w-md p-5 space-y-3"
        onClick={(e) => e.stopPropagation()}
        onSubmit={submit}
      >
        <h2 className="text-xl font-bold">{form.id ? 'Змінити кабінет' : 'Новий кабінет'}</h2>
        {error && <div className="rounded-lg bg-red-50 border border-red-200 p-2 text-red-800 text-sm">{error}</div>}
        <label className="block">
          <span className="text-sm text-gray-600">Назва *</span>
          <input
            className="w-full border rounded-lg p-3 mt-1"
            required
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            placeholder="Кабінет 1"
          />
        </label>
        <label className="block">
          <span className="text-sm text-gray-600">Порядок</span>
          <input
            type="number"
            className="w-full border rounded-lg p-3 mt-1"
            value={form.sort_order ?? 0}
            onChange={(e) => setForm({ ...form, sort_order: Number(e.target.value) || 0 })}
          />
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={form.is_active !== false}
            onChange={(e) => setForm({ ...form, is_active: e.target.checked })}
          />
          Активний
        </label>
        <div className="flex gap-2 justify-end pt-2">
          <button type="button" className="px-4 py-2 rounded-lg border" onClick={onClose}>
            Скасувати
          </button>
          <button type="submit" disabled={saving} className="px-4 py-2 rounded-lg bg-blue-600 text-white">
            {saving ? 'Збереження…' : 'Зберегти'}
          </button>
        </div>
      </form>
    </div>
  );
}
