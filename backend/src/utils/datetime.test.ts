import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  dayRangeUtc,
  normalizeBookingDatetime,
  toDateTimeLocalValue,
  zonedDateKey,
  zonedTimeHm,
} from './datetime';

describe('normalizeBookingDatetime', () => {
  it('treats naive local time as Europe/Kyiv wall clock (summer EEST)', () => {
    const iso = normalizeBookingDatetime('2026-07-24T09:00', 'Europe/Kyiv');
    assert.equal(iso, '2026-07-24T06:00:00.000Z');
  });

  it('treats naive local time as Europe/Kyiv wall clock (winter EET)', () => {
    const iso = normalizeBookingDatetime('2026-01-15T09:00', 'Europe/Kyiv');
    assert.equal(iso, '2026-01-15T07:00:00.000Z');
  });

  it('does not double-shift ISO with Z', () => {
    const iso = normalizeBookingDatetime('2026-07-24T06:00:00.000Z', 'Europe/Kyiv');
    assert.equal(iso, '2026-07-24T06:00:00.000Z');
  });

  it('accepts explicit offset', () => {
    const iso = normalizeBookingDatetime('2026-07-24T09:00:00+03:00', 'Europe/Kyiv');
    assert.equal(iso, '2026-07-24T06:00:00.000Z');
  });
});

describe('dayRangeUtc', () => {
  it('covers the full Kyiv calendar day in summer', () => {
    const { startIso, endIso } = dayRangeUtc('2026-07-24', 'Europe/Kyiv');
    // Start of 24 Jul Kyiv = 21:00 UTC previous day
    assert.equal(startIso, '2026-07-23T21:00:00.000Z');
    // endOf('day') is 23:59:59.999 Kyiv = 20:59:59.999 UTC
    assert.equal(endIso, '2026-07-24T20:59:59.999Z');
  });
});

describe('zoned helpers', () => {
  it('maps UTC midnight-edge to Kyiv date', () => {
    assert.equal(zonedDateKey('2026-07-23T21:30:00.000Z', 'Europe/Kyiv'), '2026-07-24');
    assert.equal(zonedTimeHm('2026-07-23T21:30:00.000Z', 'Europe/Kyiv'), '00:30');
  });

  it('formats datetime-local in salon TZ', () => {
    assert.equal(
      toDateTimeLocalValue('2026-07-24T06:00:00.000Z', 'Europe/Kyiv'),
      '2026-07-24T09:00'
    );
  });
});