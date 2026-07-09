import crypto from 'crypto';

const TELEGRAM_AUTH_MAX_AGE_SECONDS = 24 * 60 * 60;

export function validateTelegramData(initData: string, botToken: string): boolean {
  const params = new URLSearchParams(initData);
  const hash = params.get('hash');
  if (!hash) return false;

  if (!isFreshAuthDate(params.get('auth_date'))) return false;

  params.delete('hash');
  const dataCheckString = [...params.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
    .join('\n');

  const secretKey = crypto.createHmac('sha256', 'WebAppData').update(botToken).digest();
  const expectedHash = crypto
    .createHmac('sha256', secretKey)
    .update(dataCheckString)
    .digest('hex');

  return hash === expectedHash;
}

export function getTelegramUserFromInitData(
  initData: string
): { id: number; first_name?: string; language_code?: string } | null {
  const params = new URLSearchParams(initData);
  const user = params.get('user');
  if (!user) return null;

  try {
    return JSON.parse(user) as { id: number; first_name?: string; language_code?: string };
  } catch {
    return null;
  }
}

export function validateTelegramLoginWidget(data: Record<string, string>, botToken: string): boolean {
  const { hash, ...rest } = data;
  if (!hash) return false;
  if (!isFreshAuthDate(rest.auth_date)) return false;

  const dataCheckString = Object.keys(rest)
    .sort()
    .map((key) => `${key}=${rest[key]}`)
    .join('\n');

  const secretKey = crypto.createHash('sha256').update(botToken).digest();
  const expectedHash = crypto
    .createHmac('sha256', secretKey)
    .update(dataCheckString)
    .digest('hex');

  return hash === expectedHash;
}

export function isBookingConflictError(error: { code?: string } | null): boolean {
  return error?.code === '23505' || error?.code === '23P01';
}

function isFreshAuthDate(authDate: string | null | undefined): boolean {
  if (!authDate) return false;
  const timestamp = Number(authDate);
  if (!Number.isFinite(timestamp)) return false;

  const nowSeconds = Math.floor(Date.now() / 1000);
  return timestamp <= nowSeconds + 60 && nowSeconds - timestamp <= TELEGRAM_AUTH_MAX_AGE_SECONDS;
}
