// Pure functions: time zones, slot maths, phone numbers.
import { describe, expect, it } from 'vitest';
import { computeSlots } from '../src/lib/availability';
import { normalizePhone } from '../src/lib/tools';
import { fromLocal, toLocal, weekdayOf } from '../src/lib/time';

describe('time zone helpers', () => {
  it('converts Sofia wall-clock time to UTC in winter (+2) and summer (+3)', () => {
    expect(fromLocal('2026-11-17', '10:00', 'Europe/Sofia').toISOString()).toBe('2026-11-17T08:00:00.000Z');
    expect(fromLocal('2026-07-14', '10:00', 'Europe/Sofia').toISOString()).toBe('2026-07-14T07:00:00.000Z');
  });
  it('round-trips and knows the ISO weekday', () => {
    const d = fromLocal('2026-11-22', '18:30', 'Europe/Sofia');
    expect(toLocal(d, 'Europe/Sofia')).toEqual({ date: '2026-11-22', time: '18:30', weekday: 7 });
    expect(weekdayOf('2026-11-16')).toBe(1);
  });
});

describe('computeSlots', () => {
  const base = {
    date: '2026-11-17', hours: { open: '09:00', close: '12:00' }, durationMin: 60, stepMin: 30,
    staffIds: ['a', 'b'], busy: [], tz: 'Europe/Sofia', now: fromLocal('2026-11-16', '08:00', 'Europe/Sofia'), minLeadMin: 60,
  };

  it('only offers starts where the whole service fits before closing', () => {
    expect(computeSlots(base).map((s) => s.time)).toEqual(['09:00', '09:30', '10:00', '10:30', '11:00']);
  });

  it('a slot stays open while at least one barber is free', () => {
    const busy = [
      { staffId: 'a', start: fromLocal('2026-11-17', '10:00', base.tz), end: fromLocal('2026-11-17', '11:00', base.tz) },
      { staffId: 'b', start: fromLocal('2026-11-17', '10:00', base.tz), end: fromLocal('2026-11-17', '10:30', base.tz) },
    ];
    const slots = computeSlots({ ...base, busy });
    // 09:30-10:30 and 10:00-11:00 clash with both barbers; 10:30 only with "a".
    expect(slots.map((s) => s.time)).toEqual(['09:00', '10:30', '11:00']);
    expect(slots.find((s) => s.time === '10:30')!.freeStaffIds).toEqual(['b']);
  });

  it('respects the minimum lead time and closed days', () => {
    const now = fromLocal('2026-11-17', '09:40', base.tz);
    expect(computeSlots({ ...base, now }).map((s) => s.time)).toEqual(['11:00']);
    expect(computeSlots({ ...base, hours: null })).toEqual([]);
  });
});

describe('normalizePhone', () => {
  it.each([
    ['0888 123 456', '+359888123456'],
    ['+359 88 812 3456', '+359888123456'],
    ['00359888123456', '+359888123456'],
    ['(088) 812-34-56', '+359888123456'],
    ['+44 7700 900123', '+447700900123'],
  ])('%s -> %s', (raw, want) => expect(normalizePhone(raw)).toBe(want));

  it.each(['123', 'не знам', '0888'])('rejects %s', (raw) => expect(normalizePhone(raw)).toBeNull());
});
