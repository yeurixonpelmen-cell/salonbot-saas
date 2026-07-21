import { NavLink, Outlet } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

const nav = [
  { to: '/', label: 'Розклад', icon: '▦', end: true },
  { to: '/clients', label: 'Клієнти', icon: '◎' },
  { to: '/masters', label: 'Спеціалісти', icon: '♙' },
  { to: '/services', label: 'Послуги', icon: '◇' },
  { to: '/settings', label: 'Налаштування', icon: '⚙' },
];

export function Layout() {
  const { logout } = useAuth();

  return (
    <div className="app-shell">
      <aside className="app-sidebar">
        <div className="brand"><span>S</span><div>SalonBot<small>Кабінет салону</small></div></div>
        <nav className="desktop-nav">
          {nav.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) => `sidebar-link ${isActive ? 'active' : ''}`}
            >
              <i>{item.icon}</i>{item.label}
            </NavLink>
          ))}
        </nav>
        <button onClick={logout} className="logout-button">↪ <span>Вийти</span></button>
      </aside>

      <main className="app-main">
        <Outlet />
      </main>

      <nav className="mobile-nav">
        {nav.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.end}
            className={({ isActive }) => isActive ? 'active' : ''}
          >
            <i>{item.icon}</i><span>{item.label}</span>
          </NavLink>
        ))}
      </nav>
    </div>
  );
}
