const STORAGE_KEY = 'salonbot_admin_theme';

export type AdminTheme = 'light' | 'dark';

export function getAdminTheme(): AdminTheme {
  const saved = localStorage.getItem(STORAGE_KEY);
  return saved === 'dark' ? 'dark' : 'light';
}

export function applyAdminTheme(theme: AdminTheme): void {
  document.documentElement.dataset.theme = theme;
  localStorage.setItem(STORAGE_KEY, theme);
}

export function initAdminTheme(): AdminTheme {
  const theme = getAdminTheme();
  document.documentElement.dataset.theme = theme;
  return theme;
}
