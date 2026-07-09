import { useAuth } from '../context/AuthContext';
import { useNavigate } from 'react-router-dom';

export function SelectSalonPage() {
  const { selectSalon } = useAuth();
  const navigate = useNavigate();

  const salons = JSON.parse(sessionStorage.getItem('salon_pick_list') ?? '[]') as {
    id: string;
    name_uk: string;
  }[];
  const selectionToken = sessionStorage.getItem('salon_pick_token') ?? '';

  async function pick(salonId: string) {
    if (!selectionToken) return;
    await selectSalon(salonId, selectionToken);
    sessionStorage.removeItem('salon_pick_list');
    sessionStorage.removeItem('salon_pick_token');
    navigate('/');
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="bg-white p-8 rounded-2xl shadow-sm border max-w-md w-full">
        <h1 className="text-xl font-bold mb-4">Оберіть салон</h1>
        {!salons.length && (
          <p className="text-gray-500">Немає доступних салонів. Поверніться на сторінку входу.</p>
        )}
        <div className="space-y-2">
          {salons.map((s) => (
            <button
              key={s.id}
              onClick={() => pick(s.id)}
              className="w-full p-4 text-left rounded-lg border hover:bg-blue-50 hover:border-blue-300"
            >
              {s.name_uk}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
