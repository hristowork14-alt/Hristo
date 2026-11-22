// Timezone helpers built on Intl only (no date library).
// "Local" means the salon's wall-clock time, e.g. Europe/Sofia.

export interface LocalParts {
  date: string; // YYYY-MM-DD
  time: string; // HH:MM
  weekday: number; // ISO 1 = Monday ... 7 = Sunday
}

const WEEKDAYS: Record<string, number> = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };

/** UTC instant -> salon wall-clock parts. */
export function toLocal(instant: Date, tz: string): LocalParts {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      weekday: 'short',
      hourCycle: 'h23',
    })
      .formatToParts(instant)
      .map((p) => [p.type, p.value]),
  );
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    time: `${parts.hour}:${parts.minute}`,
    weekday: WEEKDAYS[parts.weekday],
  };
}

/** Salon wall-clock date + time -> UTC instant. Handles daylight saving time. */
export function fromLocal(date: string, time: string, tz: string): Date {
  const [y, mo, d] = date.split('-').map(Number);
  const [h, mi] = time.split(':').map(Number);
  const asUtc = Date.UTC(y, mo - 1, d, h, mi);
  // Guess, measure the zone offset at the guess, correct; repeat once for DST edges.
  let result = asUtc - offsetMinutes(new Date(asUtc), tz) * 60_000;
  result = asUtc - offsetMinutes(new Date(result), tz) * 60_000;
  return new Date(result);
}

/** Minutes the zone is ahead of UTC at that instant (Sofia: +120 winter, +180 summer). */
function offsetMinutes(instant: Date, tz: string): number {
  const l = toLocal(instant, tz);
  const [y, mo, d] = l.date.split('-').map(Number);
  const [h, mi] = l.time.split(':').map(Number);
  return Math.round((Date.UTC(y, mo - 1, d, h, mi) - Math.floor(instant.getTime() / 60_000) * 60_000) / 60_000);
}

/** ISO weekday of a YYYY-MM-DD calendar date. */
export function weekdayOf(date: string): number {
  const [y, mo, d] = date.split('-').map(Number);
  const js = new Date(Date.UTC(y, mo - 1, d)).getUTCDay(); // 0 = Sunday
  return js === 0 ? 7 : js;
}

export function addDays(date: string, days: number): string {
  const [y, mo, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, mo - 1, d + days)).toISOString().slice(0, 10);
}

export function timeToMinutes(t: string): number {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
}

export function minutesToTime(m: number): string {
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

export const BG_WEEKDAYS = ['', 'понеделник', 'вторник', 'сряда', 'четвъртък', 'петък', 'събота', 'неделя'];
export const EN_WEEKDAYS = ['', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
