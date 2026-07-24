const SUPER_TOKEN_KEY = 'super_admin_token';

export function getSuperToken(): string | null {
  return localStorage.getItem(SUPER_TOKEN_KEY);
}

export function setSuperToken(token: string): void {
  localStorage.setItem(SUPER_TOKEN_KEY, token);
}

export function clearSuperToken(): void {
  localStorage.removeItem(SUPER_TOKEN_KEY);
}

export async function superApi<T>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const token = getSuperToken();
  const headers = new Headers(options.headers);
  if (token) headers.set('Authorization', `Bearer ${token}`);
  if (options.body && !(options.body instanceof FormData) && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  const API_URL =
    import.meta.env.VITE_API_URL ||
    (import.meta.env.PROD
      ? 'https://salonbot-backend-production.up.railway.app'
      : 'http://localhost:3000');

  const res = await fetch(`${API_URL}${path}`, { ...options, headers });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'Request failed' }));
    throw err;
  }
  return res.json();
}
