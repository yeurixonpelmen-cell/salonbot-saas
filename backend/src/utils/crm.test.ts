import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  ConflictBooking,
  hasBookingConflict,
  intervalsOverlap,
  normalizePhone,
} from './crm';

function booking(
  overrides: Partial<ConflictBooking> = {}
): ConflictBooking {
  return {
    id: 'booking-1',
    master_id: 'master-1',
    booking_datetime: '2026-07-21T10:00:00.000Z',
    duration_minutes: 60,
    status: 'confirmed',
    ...overrides,
  };
}

describe('normalizePhone', () => {
  it('keeps a leading plus and removes formatting', () => {
    assert.equal(normalizePhone(' +38 (067) 123-45-67 '), '+380671234567');
  });

  it('returns null for missing or non-numeric values', () => {
    assert.equal(normalizePhone(''), null);
    assert.equal(normalizePhone('call me'), null);
    assert.equal(normalizePhone(380671234567), null);
  });
});

describe('booking conflicts', () => {
  it('treats touching interval boundaries as non-overlapping', () => {
    assert.equal(intervalsOverlap(0, 60, 60, 120), false);
    assert.equal(intervalsOverlap(0, 60, 59, 120), true);
  });

  it('excludes cancelled bookings and candidates', () => {
    const active = booking();
    const cancelledCandidate = booking({ id: 'booking-2', status: 'cancelled' });

    assert.equal(hasBookingConflict(active, [cancelledCandidate]), false);
    assert.equal(
      hasBookingConflict(booking({ status: 'cancelled' }), [
        booking({ id: 'booking-2' }),
      ]),
      false
    );
  });

  it('detects overlapping bookings for the same master', () => {
    const candidate = booking({
      id: 'booking-2',
      booking_datetime: '2026-07-21T10:30:00.000Z',
    });

    assert.equal(hasBookingConflict(booking(), [candidate]), true);
  });

  it('ignores overlapping bookings for different masters', () => {
    const candidate = booking({
      id: 'booking-2',
      master_id: 'master-2',
      booking_datetime: '2026-07-21T10:30:00.000Z',
    });

    assert.equal(hasBookingConflict(booking(), [candidate]), false);
  });
});
