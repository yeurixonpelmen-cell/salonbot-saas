export const DEFAULT_SALON_TIMEZONE = 'Europe/Kyiv';

function part(
  parts: Intl.DateTimeFormatPart[],
  type: Intl.DateTimeFormatPartTypes
): string {
  return parts.find((p) => p.type === type)?.value ?? '';
}

/** Calendar YYYY-MM-DD in salon timezone. */
export function zonedDateKey(
  isoOrDate: string | Date,
  timeZone: string = DEFAULT_SALON_TIMEZONE
): string {
  const date = parseInstant(isoOrDate, timeZone);
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  return `${part(parts, 'year')}-${part(parts, 'month')}-${part(parts, 'day')}`;
}

/** HH:mm in salon timezone. */
export function zonedTimeHm(
  isoOrDate: string | Date,
  timeZone: string = DEFAULT_SALON_TIMEZONE
): string {
  const date = parseInstant(isoOrDate, timeZone);
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  const hour = part(parts, 'hour').padStart(2, '0');
  const minute = part(parts, 'minute').padStart(2, '0');
  return `${hour}:${minute}`;
}

/**
 * Parse API/ISO datetimes. Naive `YYYY-MM-DDTHH:mm[:ss]` is wall clock in salon TZ
 * (same as backend normalizeBookingDatetime), not the browser's local zone.
 */
function parseInstant(
  isoOrDate: string | Date,
  timeZone: string = DEFAULT_SALON_TIMEZONE
): Date {
  if (typeof isoOrDate !== 'string') return isoOrDate;
  const trimmed = isoOrDate.trim();
  const hasZone = /(?:[zZ]|[+-]\d{2}:?\d{2})$/.test(trimmed);
  if (hasZone) return new Date(trimmed);

  const match = trimmed.match(
    /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?/
  );
  if (!match) return new Date(trimmed);

  const [, y, mo, d, h, mi, s] = match;
  const asUtcProbe = new Date(
    `${y}-${mo}-${d}T${h}:${mi}:${s ?? '00'}Z`
  );
  const shown = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(asUtcProbe);
  const shownY = Number(part(shown, 'year'));
  const shownMo = Number(part(shown, 'month'));
  const shownD = Number(part(shown, 'day'));
  const shownH = Number(part(shown, 'hour'));
  const shownMi = Number(part(shown, 'minute'));
  const shownS = Number(part(shown, 'second'));
  const wanted = Date.UTC(
    Number(y),
    Number(mo) - 1,
    Number(d),
    Number(h),
    Number(mi),
    Number(s ?? '00')
  );
  const got = Date.UTC(shownY, shownMo - 1, shownD, shownH, shownMi, shownS);
  return new Date(asUtcProbe.getTime() + (wanted - got));
}

/** Value for `<input type="datetime-local">` in salon timezone. */
export function toDateTimeLocalValue(
  iso: string,
  timeZone: string = DEFAULT_SALON_TIMEZONE
): string {
  return `${zonedDateKey(iso, timeZone)}T${zonedTimeHm(iso, timeZone)}`;
}

export function todayInTimeZone(timeZone: string = DEFAULT_SALON_TIMEZONE): string {
  return zonedDateKey(new Date(), timeZone);
}

export function minutesSinceMidnight(
  iso: string,
  timeZone: string = DEFAULT_SALON_TIMEZONE
): number {
  const [h, m] = zonedTimeHm(iso, timeZone).split(':').map(Number);
  return h * 60 + m;
}
