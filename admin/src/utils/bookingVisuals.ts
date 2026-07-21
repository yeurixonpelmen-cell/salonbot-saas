import type { Booking } from '../api';

type BookingVisualState = Pick<
  Booking,
  'status' | 'visit_status' | 'needs_attention' | 'has_conflict'
>;

export function bookingTone(booking: BookingVisualState): string {
  if (booking.visit_status === 'refused') return 'booking-refused';
  if (booking.visit_status === 'waiting') return 'booking-waiting';
  if (booking.visit_status === 'first_visit') return 'booking-first';
  if (
    booking.visit_status === 'completed' ||
    booking.status === 'completed'
  ) {
    return 'booking-completed';
  }
  return booking.status === 'confirmed'
    ? 'booking-confirmed'
    : 'booking-default';
}

export function bookingNeedsAttention(booking: BookingVisualState): boolean {
  return booking.needs_attention || booking.has_conflict;
}
