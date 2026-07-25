import { NavLink, Outlet } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

const nav = [
  { to: '/', label: 'Розклад', icon: 'calendar', end: true },
  { to: '/clients', label: 'Клієнти', icon: 'users' },
  { to: '/masters', label: 'Спеціалісти', icon: 'user' },
  { to: '/services', label: 'Послуги', icon: 'spark' },
  { to: '/settings', label: 'Налаштування', icon: 'gear' },
] as const;

function NavIcon({ name }: { name: (typeof nav)[number]['icon'] | 'logout' }) {
  const common = {
    width: 18,
    height: 18,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.8,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    'aria-hidden': true,
  };

  switch (name) {
    case 'calendar':
      return (
        <svg {...common}>
          <rect x="3" y="5" width="18" height="16" rx="2" />
          <path d="M3 10h18M8 3v4M16 3v4" />
        </svg>
      );
    case 'users':
      return (
        <svg {...common}>
          <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
          <circle cx="9" cy="7" r="3.5" />
          <path d="M22 21v-2a3.5 3.5 0 0 0-2.5-3.35M16.5 3.7a3.5 3.5 0 0 1 0 6.6" />
        </svg>
      );
    case 'user':
      return (
        <svg {...common}>
          <circle cx="12" cy="8" r="3.5" />
          <path d="M5 20a7 7 0 0 1 14 0" />
        </svg>
      );
    case 'spark':
      return (
        <svg {...common}>
          <path d="M12 3l1.6 5.2L19 10l-5.4 1.8L12 17l-1.6-5.2L5 10l5.4-1.8L12 3z" />
        </svg>
      );
    case 'gear':
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="3" />
          <path d="M12 2.5v2.2M12 19.3v2.2M4.6 6.5l1.6 1.6M17.8 15.9l1.6 1.6M2.5 12h2.2M19.3 12h2.2M4.6 17.5l1.6-1.6M17.8 8.1l1.6-1.6" />
        </svg>
      );
    case 'logout':
      return (
        <svg {...common}>
          <path d="M10 4H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h4" />
          <path d="M15 12H9M15 12l-3-3M15 12l-3 3" />
        </svg>
      );
  }
}

export function Layout() {
  const { logout } = useAuth();

  return (
    <div className="app-shell">
      <aside className="app-sidebar">
        <div className="brand">
          <span className="brand-mark" aria-hidden>SB</span>
          <div>
            SalonBot
            <small>Розклад · CRM</small>
          </div>
        </div>
        <nav className="desktop-nav">
          {nav.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={'end' in item ? item.end : false}
              className={({ isActive }) => `sidebar-link ${isActive ? 'active' : ''}`}
            >
              <i><NavIcon name={item.icon} /></i>
              {item.label}
            </NavLink>
          ))}
        </nav>
        <button type="button" onClick={logout} className="logout-button">
          <NavIcon name="logout" />
          <span>Вийти</span>
        </button>
      </aside>

      <main className="app-main">
        <Outlet />
      </main>

      <nav className="mobile-nav">
        {nav.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={'end' in item ? item.end : false}
            className={({ isActive }) => (isActive ? 'active' : '')}
          >
            <i><NavIcon name={item.icon} /></i>
            <span>{item.label}</span>
          </NavLink>
        ))}
      </nav>
    </div>
  );
}
