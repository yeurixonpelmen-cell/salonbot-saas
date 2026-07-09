import { NavLink, Outlet } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

const nav = [
  { to: '/', label: '📅 Розклад', end: true },
  { to: '/masters', label: '👥 Майстри' },
  { to: '/services', label: '✂️ Послуги' },
  { to: '/settings', label: '⚙️ Налаштування' },
];

export function Layout() {
  const { logout } = useAuth();

  return (
    <div className="min-h-screen flex flex-col md:flex-row">
      <aside className="md:w-56 bg-white border-r border-gray-200 p-4">
        <div className="font-bold text-lg mb-6 px-2">SalonBot</div>
        <nav className="space-y-1 hidden md:block">
          {nav.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) => `sidebar-link ${isActive ? 'active' : ''}`}
            >
              {item.label}
            </NavLink>
          ))}
          <button onClick={logout} className="sidebar-link w-full text-left text-red-600 mt-4">
            Вийти
          </button>
        </nav>
      </aside>

      <main className="flex-1 p-4 md:p-6 pb-20 md:pb-6 overflow-auto">
        <Outlet />
      </main>

      <nav className="md:hidden fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 flex">
        {nav.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.end}
            className={({ isActive }) =>
              `flex-1 py-3 text-center text-xs ${isActive ? 'text-blue-600 font-medium' : 'text-gray-600'}`
            }
          >
            {item.label.split(' ')[0]}
          </NavLink>
        ))}
      </nav>
    </div>
  );
}
