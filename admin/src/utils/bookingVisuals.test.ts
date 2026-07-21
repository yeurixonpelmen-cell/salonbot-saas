import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { Booking } from '../api';
import { bookingNeedsAttention, bookingTone } from './bookingVisuals';

type VisualBooking = Pick<
  Booking,
  'status' | 'visit_status' | 'needs_attention' | 'has_conflict'
>;

function booking(overrides: Partial<VisualBooking> = {}): VisualBooking {
  return {
    status: 'pending',
    visit_status: 'scheduled',
    needs_attention: false,
    has_conflict: false,
    ...overrides,
  };
}

describe('bookingTone', () => {
  it('gives refused red the highest priority', () => {
    assert.equal(
      bookingTone(
        booking({ status: 'completed', visit_status: 'refused' })
      ),
      'booking-refused'
    );
  });

  it('uses yellow for waiting visits', () => {
    assert.equal(
      bookingTone(booking({ visit_status: 'waiting' })),
      'booking-waiting'
    );
  });

  it('uses purple for first visits', () => {
    assert.equal(
      bookingTone(booking({ visit_status: 'first_visit' })),
      'booking-first'
    );
  });

  it('uses gray for completed visits or bookings', () => {
    assert.equal(
      bookingTone(booking({ visit_status: 'completed' })),
      'booking-completed'
    );
    assert.equal(
      bookingTone(booking({ status: 'completed' })),
      'booking-completed'
    );
  });

  it('distinguishes confirmed from default bookings', () => {
    assert.equal(
      bookingTone(booking({ status: 'confirmed' })),
      'booking-confirmed'
    );
    assert.equal(bookingTone(booking()), 'booking-default');
  });
});

describe('bookingNeedsAttention', () => {
  it('is true for needs_attention or has_conflict', () => {
    assert.equal(
      bookingNeedsAttention(booking({ needs_attention: true })),
      true
    );
    assert.equal(
      bookingNeedsAttention(booking({ has_conflict: true })),
      true
    );
    assert.equal(bookingNeedsAttention(booking()), false);
  });
});
