export interface ConflictBooking {
  id: string;
  master_id: string;
  booking_datetime: string;
  duration_minutes: number;
  status: string;
}

export function normalizePhone(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const prefix = trimmed.startsWith('+') ? '+' : '';
  const digits = trimmed.replace(/\D/g, '');
  return digits ? `${prefix}${digits}` : null;
}

export function intervalsOverlap(
  start: number,
  end: number,
  candidateStart: number,
  candidateEnd: number
): boolean {
  return start < candidateEnd && candidateStart < end;
}

export function hasBookingConflict(
  booking: ConflictBooking,
  candidates: ConflictBooking[]
): boolean {
  if (booking.status === 'cancelled') return false;

  const start = new Date(booking.booking_datetime).getTime();
  const end = start + Number(booking.duration_minutes) * 60_000;

  return candidates.some((candidate) => {
    if (
      candidate.id === booking.id ||
      candidate.master_id !== booking.master_id ||
      candidate.status === 'cancelled'
    ) {
      return false;
    }

    const candidateStart = new Date(candidate.booking_datetime).getTime();
    const candidateEnd =
      candidateStart + Number(candidate.duration_minutes) * 60_000;
    return intervalsOverlap(start, end, candidateStart, candidateEnd);
  });
}
