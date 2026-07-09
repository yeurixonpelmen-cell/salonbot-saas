const API_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:3000';

function getInitData(): string {
  return window.Telegram?.WebApp?.initData ?? '';
}

export async function apiGet<T>(path: string): Promise<T> {
  const headers: Record<string, string> = {};
  const initData = getInitData();
  if (initData && path.includes('/slots')) {
    headers['X-Telegram-Init-Data'] = initData;
  }
  const res = await fetch(`${API_URL}${path}`, { headers });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'Request failed' }));
    throw err;
  }
  return res.json();
}

export async function apiPost<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Telegram-Init-Data': getInitData(),
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'Error' }));
    throw err;
  }
  return res.json();
}

export interface SalonInfo {
  name_uk: string;
  name_en: string | null;
  logo_url: string | null;
  address: string | null;
}

export interface Service {
  id: string;
  name_uk: string;
  name_en: string | null;
  duration_minutes: number;
  price: number | null;
}

export interface Master {
  id: string;
  name: string;
  photo_url: string | null;
  position: string | null;
}
