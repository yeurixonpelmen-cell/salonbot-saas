import { supabase } from '../db/client';

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

function getDayOfWeek(date: Date): number {
  const d = date.getDay();
  return d === 0 ? 7 : d;
}

function rangesOverlap(
  start1: number,
  end1: number,
  start2: number,
  end2: number
): boolean {
  return start1 < end2 && start2 < end1;
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
  const now = new Date();

  for (let day = 0; day < daysAhead; day++) {
    const date = new Date(now);
    date.setDate(date.getDate() + day);
    date.setHours(0, 0, 0, 0);

    const dateKey = date.toISOString().slice(0, 10);
    const dayOfWeek = getDayOfWeek(date);
    const slotsSet = new Set<string>();

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

      const dayStartDt = new Date(date);
      dayStartDt.setHours(Math.floor(dayStart / 60), dayStart % 60, 0, 0);
      const dayEndDt = new Date(date);
      dayEndDt.setHours(Math.floor(dayEnd / 60), dayEnd % 60, 0, 0);

      const { data: bookings } = await supabase
        .from('bookings')
        .select('booking_datetime, duration_minutes')
        .eq('master_id', mId)
        .neq('status', 'cancelled')
        .gte('booking_datetime', dayStartDt.toISOString())
        .lt('booking_datetime', dayEndDt.toISOString());

      const busyRanges = (bookings ?? []).map((b) => {
        const start = new Date(b.booking_datetime);
        const startMin = start.getHours() * 60 + start.getMinutes();
        const endMin = startMin + b.duration_minutes;
        return { start: startMin, end: endMin };
      });

      for (let slot = dayStart; slot + duration <= dayEnd; slot += duration) {
        const slotEnd = slot + duration;
        const slotDate = new Date(date);
        slotDate.setHours(Math.floor(slot / 60), slot % 60, 0, 0);

        if (slotDate <= now) continue;

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

  const slots = await generateSlots(salonId, masterId, serviceId, 14);
  const slotDate = new Date(datetime);
  const dateKey = slotDate.toISOString().slice(0, 10);
  const time = `${String(slotDate.getHours()).padStart(2, '0')}:${String(
    slotDate.getMinutes()
  ).padStart(2, '0')}`;

  return slots[dateKey]?.includes(time) ?? false;
}

export { GRID_SLOT_MINUTES };

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
