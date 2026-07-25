const STORAGE_KEY = 'salonbot_admin_theme';

export type AdminTheme = 'light' | 'dark';

export function getAdminTheme(): AdminTheme {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    return saved === 'dark' ? 'dark' : 'light';
  } catch {
    return 'light';
  }
}

export function applyAdminTheme(theme: AdminTheme): void {
  const root = document.documentElement;
  root.dataset.theme = theme;
  // Prevent Android Chrome "Auto dark" from fighting our own theme toggle
  root.style.colorScheme = theme === 'dark' ? 'only dark' : 'only light';
  try {
    localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    // ignore
  }

  let meta = document.querySelector('meta[name="color-scheme"]');
  if (!meta) {
    meta = document.createElement('meta');
    meta.setAttribute('name', 'color-scheme');
    document.head.appendChild(meta);
  }
  meta.setAttribute('content', theme === 'dark' ? 'dark' : 'light');

  let themeColor = document.querySelector('meta[name="theme-color"]');
  if (!themeColor) {
    themeColor = document.createElement('meta');
    themeColor.setAttribute('name', 'theme-color');
    document.head.appendChild(themeColor);
  }
  themeColor.setAttribute('content', theme === 'dark' ? '#1e2026' : '#eef5f3');
}

export function initAdminTheme(): AdminTheme {
  const theme = getAdminTheme();
  applyAdminTheme(theme);
  return theme;
}
