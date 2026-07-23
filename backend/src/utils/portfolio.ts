export type PortfolioMediaType = 'photo' | 'video';

export interface MasterPortfolioItem {
  type: PortfolioMediaType;
  url: string;
  caption?: string;
}

const MAX_ITEMS = 24;

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

export function normalizePortfolio(raw: unknown): MasterPortfolioItem[] {
  if (!Array.isArray(raw)) return [];

  const items: MasterPortfolioItem[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue;
    const type = (entry as { type?: unknown }).type;
    const url = typeof (entry as { url?: unknown }).url === 'string'
      ? (entry as { url: string }).url.trim()
      : '';
    const captionRaw = (entry as { caption?: unknown }).caption;
    const caption =
      typeof captionRaw === 'string' && captionRaw.trim()
        ? captionRaw.trim().slice(0, 200)
        : undefined;

    if ((type !== 'photo' && type !== 'video') || !url || !isHttpUrl(url)) continue;
    items.push({ type, url, ...(caption ? { caption } : {}) });
    if (items.length >= MAX_ITEMS) break;
  }
  return items;
}

export function normalizeBio(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const bio = raw.trim().slice(0, 1000);
  return bio || null;
}
