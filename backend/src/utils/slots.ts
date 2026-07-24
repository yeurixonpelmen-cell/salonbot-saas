import { DateTime } from 'luxon';
import { supabase } from '../db/client';
import {
  DEFAULT_SALON_TIMEZONE,
  dayRangeUtc,
  normalizeBookingDatetime,
  resolveSalonTimezone,
  zonedDateKey,
  zonedTimeHm,
} from './datetime';

const GRID_SLOT_MINUTES = 30;

function parseTime(time: string): number {
  const [h, m] = time.split(':').map(Number);
  return h * 60 + m;
}

function formatTime(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

function rangesOverlap(
  start1: number,
  end1: number,
  start2: number,
  end2: number
): boolean {
  return start1 < end2 && start2 < end1;
}

async function loadSalonTimezone(salonId: string): Promise<string> {
  const { data } = await supabase
    .from('salons')
    .select('timezone')
    .eq('id', salonId)
    .maybeSingle();
  return resolveSalonTimezone(data?.timezone);
}

export async function generateSlots(
  salonId: string,
  masterId: string | null,
  serviceId: string,
  daysAhead = 14
): Promise<Record<string, string[]>> {
  const { data: service } = await supabase
    .from('services')
    .select('duration_minutes')
    .eq('id', serviceId)
    .eq('salon_id', salonId)
    .single();

  if (!service) return {};

  const duration = service.duration_minutes as number;
  const timeZone = await loadSalonTimezone(salonId);

  let masterIds: string[] = [];
  if (masterId) {
    const isValid = await masterCanPerformService(salonId, masterId, serviceId);
    masterIds = isValid ? [masterId] : [];
  } else {
    const { data: links } = await supabase
      .from('master_services')
      .select('master_id, masters!inner(salon_id, is_active)')
      .eq('service_id', serviceId)
      .eq('masters.salon_id', salonId)
      .eq('masters.is_active', true);
    masterIds = (links ?? []).map((l) => l.master_id);
  }

  const result: Record<string, string[]> = {};
  const now = DateTime.now().setZone(timeZone);

  for (let day = 0; day < daysAhead; day++) {
    const dayStartLocal = now.startOf('day').plus({ days: day });
    const dateKey = dayStartLocal.toFormat('yyyy-MM-dd');
    const dayOfWeek = dayStartLocal.weekday; // 1=Mon … 7=Sun (Luxon)
    const slotsSet = new Set<string>();
    const { startIso, endIso } = dayRangeUtc(dateKey, timeZone);

    for (const mId of masterIds) {
      const { data: schedule } = await supabase
        .from('schedules')
        .select('start_time, end_time')
        .eq('master_id', mId)
        .eq('day_of_week', dayOfWeek)
        .maybeSingle();

      if (!schedule) continue;

      const dayStart = parseTime(schedule.start_time.slice(0, 5));
      const dayEnd = parseTime(schedule.end_time.slice(0, 5));

      const { data: bookings } = await supabase
        .from('bookings')
        .select('booking_datetime, duration_minutes')
        .eq('master_id', mId)
        .neq('status', 'cancelled')
        .gte('booking_datetime', startIso)
        .lte('booking_datetime', endIso);

      const busyRanges = (bookings ?? []).map((b) => {
        const startMin =
          parseTime(zonedTimeHm(b.booking_datetime, timeZone));
        const endMin = startMin + b.duration_minutes;
        return { start: startMin, end: endMin };
      });

      for (let slot = dayStart; slot + duration <= dayEnd; slot += duration) {
        const slotEnd = slot + duration;
        const slotLocal = dayStartLocal.set({
          hour: Math.floor(slot / 60),
          minute: slot % 60,
          second: 0,
          millisecond: 0,
        });

        if (slotLocal <= now) continue;

        const overlaps = busyRanges.some((r) =>
          rangesOverlap(slot, slotEnd, r.start, r.end)
        );
        if (!overlaps) {
          slotsSet.add(formatTime(slot));
        }
      }
    }

    if (slotsSet.size > 0) {
      result[dateKey] = [...slotsSet].sort();
    }
  }

  return result;
}

export async function findAvailableMaster(
  salonId: string,
  serviceId: string,
  datetime: string
): Promise<string | null> {
  const { data: links } = await supabase
    .from('master_services')
    .select('master_id, masters!inner(salon_id, is_active)')
    .eq('service_id', serviceId)
    .eq('masters.salon_id', salonId)
    .eq('masters.is_active', true);

  for (const link of links ?? []) {
    if (await isSlotAvailable(salonId, link.master_id, serviceId, datetime)) {
      return link.master_id;
    }
  }
  return null;
}

export async function masterCanPerformService(
  salonId: string,
  masterId: string,
  serviceId: string
): Promise<boolean> {
  const { data } = await supabase
    .from('master_services')
    .select('master_id, masters!inner(salon_id, is_active), services!inner(salon_id, is_active)')
    .eq('master_id', masterId)
    .eq('service_id', serviceId)
    .eq('masters.salon_id', salonId)
    .eq('masters.is_active', true)
    .eq('services.salon_id', salonId)
    .eq('services.is_active', true)
    .maybeSingle();

  return Boolean(data);
}

export async function isSlotAvailable(
  salonId: string,
  masterId: string,
  serviceId: string,
  datetime: string
): Promise<boolean> {
  if (!(await masterCanPerformService(salonId, masterId, serviceId))) return false;

  const timeZone = await loadSalonTimezone(salonId);
  const normalized = normalizeBookingDatetime(datetime, timeZone);
  const slots = await generateSlots(salonId, masterId, serviceId, 14);
  const dateKey = zonedDateKey(normalized, timeZone);
  const time = zonedTimeHm(normalized, timeZone);

  return slots[dateKey]?.includes(time) ?? false;
}

export { GRID_SLOT_MINUTES, DEFAULT_SALON_TIMEZONE };

export function getGridTimeSlots(startHour = 8, endHour = 20): string[] {
  const slots: string[] = [];
  for (let m = startHour * 60; m < endHour * 60; m += GRID_SLOT_MINUTES) {
    slots.push(formatTime(m));
  }
  return slots;
}

export function timeToRowIndex(time: string, startHour = 8): number {
  const [h, m] = time.split(':').map(Number);
  const minutes = h * 60 + m - startHour * 60;
  return Math.floor(minutes / GRID_SLOT_MINUTES);
}

export function durationToRowSpan(durationMinutes: number): number {
  return Math.max(1, Math.ceil(durationMinutes / GRID_SLOT_MINUTES));
}
