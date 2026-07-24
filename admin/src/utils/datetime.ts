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
  const date = typeof isoOrDate === 'string' ? new Date(isoOrDate) : isoOrDate;
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
  const date = typeof isoOrDate === 'string' ? new Date(isoOrDate) : isoOrDate;
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  return `${part(parts, 'hour')}:${part(parts, 'minute')}`;
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
