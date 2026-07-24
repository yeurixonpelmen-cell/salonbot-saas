import { DateTime } from 'luxon';

export const DEFAULT_SALON_TIMEZONE = 'Europe/Kyiv';

export function resolveSalonTimezone(raw: string | null | undefined): string {
  const value = (raw ?? '').trim();
  if (!value) return DEFAULT_SALON_TIMEZONE;
  if (!DateTime.now().setZone(value).isValid) return DEFAULT_SALON_TIMEZONE;
  return value;
}

/**
 * Normalize booking input to UTC ISO.
 * - Naive `YYYY-MM-DDTHH:mm[:ss]` = wall clock in salon timezone
 * - Strings with Z / offset = absolute instant
 */
export function normalizeBookingDatetime(
  raw: string,
  timeZone: string = DEFAULT_SALON_TIMEZONE
): string {
  const trimmed = raw.trim();
  if (!trimmed) {
    throw new Error('Invalid datetime');
  }

  const zone = resolveSalonTimezone(timeZone);
  const hasZone = /(?:[zZ]|[+-]\d{2}:?\d{2})$/.test(trimmed);

  const parsed = hasZone
    ? DateTime.fromISO(trimmed, { setZone: true })
    : DateTime.fromISO(trimmed, { zone });

  if (!parsed.isValid) {
    throw new Error(parsed.invalidExplanation ?? 'Invalid datetime');
  }

  return parsed.toUTC().toISO({ suppressMilliseconds: false })!;
}

export function dayRangeUtc(
  dateYmd: string,
  timeZone: string = DEFAULT_SALON_TIMEZONE
): { startIso: string; endIso: string } {
  const zone = resolveSalonTimezone(timeZone);
  const start = DateTime.fromISO(`${dateYmd}T00:00:00`, { zone });
  if (!start.isValid) {
    throw new Error(start.invalidExplanation ?? 'Invalid date');
  }
  const end = start.endOf('day');
  return {
    startIso: start.toUTC().toISO()!,
    endIso: end.toUTC().toISO()!,
  };
}

export function zonedDateKey(
  date: Date | string,
  timeZone: string = DEFAULT_SALON_TIMEZONE
): string {
  const zone = resolveSalonTimezone(timeZone);
  const dt =
    typeof date === 'string'
      ? DateTime.fromISO(date, { setZone: true }).setZone(zone)
      : DateTime.fromJSDate(date).setZone(zone);
  if (!dt.isValid) {
    throw new Error(dt.invalidExplanation ?? 'Invalid date');
  }
  return dt.toFormat('yyyy-MM-dd');
}

export function zonedTimeHm(
  date: Date | string,
  timeZone: string = DEFAULT_SALON_TIMEZONE
): string {
  const zone = resolveSalonTimezone(timeZone);
  const dt =
    typeof date === 'string'
      ? DateTime.fromISO(date, { setZone: true }).setZone(zone)
      : DateTime.fromJSDate(date).setZone(zone);
  if (!dt.isValid) {
    throw new Error(dt.invalidExplanation ?? 'Invalid date');
  }
  return dt.toFormat('HH:mm');
}

/** Format UTC/ISO instant for `<input type="datetime-local">` in salon TZ. */
export function toDateTimeLocalValue(
  iso: string,
  timeZone: string = DEFAULT_SALON_TIMEZONE
): string {
  const zone = resolveSalonTimezone(timeZone);
  const dt = DateTime.fromISO(iso, { setZone: true }).setZone(zone);
  if (!dt.isValid) {
    throw new Error(dt.invalidExplanation ?? 'Invalid datetime');
  }
  return dt.toFormat("yyyy-MM-dd'T'HH:mm");
}

export async function getSalonTimezone(
  fetchTimezone: () => Promise<string | null | undefined>
): Promise<string> {
  return resolveSalonTimezone(await fetchTimezone());
}
