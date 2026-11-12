// Pure slot calculation (no database), so it is easy to unit test.
import { fromLocal, minutesToTime, timeToMinutes } from './time';

export interface Busy {
  staffId: string;
  start: Date;
  end: Date;
}

export interface Slot {
  time: string; // HH:MM salon time
  startsAt: Date;
  endsAt: Date;
  freeStaffIds: string[];
}

export interface SlotInput {
  date: string; // YYYY-MM-DD salon time
  hours: { open: string; close: string } | null; // null = closed that day
  durationMin: number;
  stepMin: number;
  staffIds: string[];
  busy: Busy[];
  tz: string;
  now: Date;
  minLeadMin: number;
}

/**
 * Every start time (every `stepMin` minutes) where the whole service fits inside opening
 * hours, starts at least `minLeadMin` from now, and at least one barber is free.
 */
export function computeSlots(input: SlotInput): Slot[] {
  if (!input.hours) return [];
  const open = timeToMinutes(input.hours.open);
  const close = timeToMinutes(input.hours.close);
  const earliest = input.now.getTime() + input.minLeadMin * 60_000;
  const slots: Slot[] = [];

  for (let m = open; m + input.durationMin <= close; m += input.stepMin) {
    const time = minutesToTime(m);
    const startsAt = fromLocal(input.date, time, input.tz);
    const endsAt = new Date(startsAt.getTime() + input.durationMin * 60_000);
    if (startsAt.getTime() < earliest) continue;

    const freeStaffIds = input.staffIds.filter(
      (id) => !input.busy.some((b) => b.staffId === id && b.start < endsAt && b.end > startsAt),
    );
    if (freeStaffIds.length > 0) slots.push({ time, startsAt, endsAt, freeStaffIds });
  }
  return slots;
}
