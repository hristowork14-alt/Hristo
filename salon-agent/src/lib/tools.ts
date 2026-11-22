// The five tools the agent can call, their JSON schemas for Claude, and their handlers.
// Handlers enforce every business rule themselves (hours, lead time, double-booking,
// phone check on changes), so a confused or manipulated model still cannot break them.
import type Anthropic from '@anthropic-ai/sdk';
import { randomInt } from 'node:crypto';
import { z } from 'zod';
import { computeSlots, type Busy } from './availability';
import type { Sql } from './db';
import { findService, listHours, listServices, listStaff, type Salon, type Service } from './salon';
import { addDays, BG_WEEKDAYS, EN_WEEKDAYS, fromLocal, toLocal, weekdayOf } from './time';

export interface ToolContext {
  sql: Sql;
  salon: Salon;
  conversationId: string;
  now: Date;
}

// ── Schemas shown to Claude ────────────────────────────────────────────────────

export const TOOL_DEFINITIONS: Anthropic.Beta.BetaTool[] = [
  {
    name: 'get_services',
    description:
      'Returns every service the salon offers with its id, Bulgarian and English name, duration in minutes and price. ' +
      'Call this before mentioning any service, price or duration.',
    input_schema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'check_availability',
    description:
      'Returns the free start times for one service on one date (salon local time). If the day is closed or full, ' +
      'it also returns the nearest dates that have free times. Call this before offering or confirming any time.',
    input_schema: {
      type: 'object',
      properties: {
        service: { type: 'string', description: 'Service id from get_services' },
        date: { type: 'string', description: 'Date in YYYY-MM-DD format, salon local time' },
      },
      required: ['service', 'date'],
      additionalProperties: false,
    },
  },
  {
    name: 'book_appointment',
    description:
      'Books an appointment. Only call it after the customer has chosen a free time from check_availability ' +
      'and given their name and phone number. Returns a booking code to tell the customer.',
    input_schema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: "Customer's name" },
        phone: { type: 'string', description: "Customer's phone number, e.g. 0888123456 or +359888123456" },
        service: { type: 'string', description: 'Service id from get_services' },
        slot: { type: 'string', description: 'Start time as "YYYY-MM-DD HH:MM", salon local time' },
        barber: { type: 'string', description: 'Optional: barber name if the customer asked for a specific one' },
      },
      required: ['name', 'phone', 'service', 'slot'],
      additionalProperties: false,
    },
  },
  {
    name: 'cancel_or_reschedule',
    description:
      'Cancels a booking, or moves it to a new time when new_slot is given. Needs the booking code and the phone ' +
      'number the booking was made with. Check the new time with check_availability first.',
    input_schema: {
      type: 'object',
      properties: {
        booking_id: { type: 'string', description: 'Booking code the customer received, e.g. K7M2QX' },
        phone: { type: 'string', description: 'Phone number used for the booking' },
        new_slot: { type: 'string', description: 'Optional: new start time "YYYY-MM-DD HH:MM". Leave out to cancel.' },
      },
      required: ['booking_id', 'phone'],
      additionalProperties: false,
    },
  },
  {
    name: 'handoff_to_human',
    description:
      'Flags the conversation for a staff member to follow up. Use it when you cannot help from the tools, ' +
      'when the customer asks for a person, complains, or asks something you are unsure about.',
    input_schema: {
      type: 'object',
      properties: {
        reason: { type: 'string', description: 'Short reason, for the salon staff' },
      },
      required: ['reason'],
      additionalProperties: false,
    },
  },
];

// ── Input validation (the model's JSON is checked before anything runs) ─────────

const dateRe = /^\d{4}-\d{2}-\d{2}$/;
const slotRe = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2})$/;

const inputs = {
  get_services: z.object({}).passthrough(),
  check_availability: z.object({ service: z.string().min(1), date: z.string().regex(dateRe) }),
  book_appointment: z.object({
    name: z.string().trim().min(2).max(80),
    phone: z.string().min(1).max(30),
    service: z.string().min(1),
    slot: z.string().regex(slotRe),
    barber: z.string().optional().nullable(),
  }),
  cancel_or_reschedule: z.object({
    booking_id: z.string().min(4).max(20),
    phone: z.string().min(1).max(30),
    new_slot: z.string().regex(slotRe).optional().nullable(),
  }),
  handoff_to_human: z.object({ reason: z.string().min(1).max(500) }),
};

export type ToolName = keyof typeof inputs;

/** What a handler returns: JSON for Claude, plus whether it is an error. */
export interface ToolResult {
  ok: boolean;
  data: Record<string, unknown>;
}

const fail = (error: string, extra: Record<string, unknown> = {}): ToolResult => ({
  ok: false,
  data: { error, ...extra },
});

// ── Entry point: validate, run, log ────────────────────────────────────────────

export async function runTool(name: string, rawInput: unknown, ctx: ToolContext): Promise<ToolResult> {
  const started = Date.now();
  let result: ToolResult;
  try {
    if (!(name in inputs)) {
      result = fail('unknown_tool');
    } else {
      const parsed = inputs[name as ToolName].safeParse(rawInput ?? {});
      if (!parsed.success) {
        result = fail('invalid_input', { details: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`) });
      } else {
        result = await HANDLERS[name as ToolName](parsed.data as never, ctx);
      }
    }
  } catch (e) {
    console.error(`[tool] ${name} crashed`, e);
    result = fail('internal_error');
  }

  const durationMs = Date.now() - started;
  // Log every call: to the console (server logs) and to the tool_calls table.
  console.log(
    JSON.stringify({ at: 'tool', conversation: ctx.conversationId, tool: name, input: rawInput, ok: result.ok, durationMs, output: result.data }),
  );
  await ctx.sql`
    insert into tool_calls (conversation_id, tool, input, output, is_error, duration_ms)
    values (${ctx.conversationId}, ${name}, ${ctx.sql.json((rawInput ?? {}) as never)},
            ${ctx.sql.json(result.data as never)}, ${!result.ok}, ${durationMs})`.catch((e) =>
    console.error('[tool] could not log tool call', e),
  );
  return result;
}

// ── Handlers ───────────────────────────────────────────────────────────────────

type Input<N extends ToolName> = z.infer<(typeof inputs)[N]>;
type Handler<N extends ToolName> = (input: Input<N>, ctx: ToolContext) => Promise<ToolResult>;

const HANDLERS: { [N in ToolName]: Handler<N> } = {
  async get_services(_input, ctx) {
    const services = await listServices(ctx.salon.id);
    return {
      ok: true,
      data: {
        currency: ctx.salon.currency,
        services: services.map((s) => ({ id: s.id, name_bg: s.name_bg, name_en: s.name_en, duration_min: s.duration_min, price: s.price })),
      },
    };
  },

  async check_availability({ service, date }, ctx) {
    const svc = findService(await listServices(ctx.salon.id), service);
    if (!svc) return fail('unknown_service', { hint: 'Call get_services and pass a service id' });
    const range = checkDateRange(date, ctx);
    if (range) return range;

    const day = await daySlots(ctx, svc, date);
    const result: Record<string, unknown> = {
      date,
      weekday_bg: BG_WEEKDAYS[weekdayOf(date)],
      weekday_en: EN_WEEKDAYS[weekdayOf(date)],
      service: { id: svc.id, name_bg: svc.name_bg, name_en: svc.name_en, duration_min: svc.duration_min },
      closed: day.closed,
      opening_hours: day.hours ? `${day.hours.open}-${day.hours.close}` : null,
      free_times: day.slots.map((s) => s.time),
    };
    if (day.slots.length === 0) {
      // Help the agent offer an alternative instead of a dead end.
      result.next_available = await nextAvailableDays(ctx, svc, date, 3);
    }
    return { ok: true, data: result };
  },

  async book_appointment({ name, phone, service, slot, barber }, ctx) {
    const normalizedPhone = normalizePhone(phone);
    if (!normalizedPhone) return fail('invalid_phone', { hint: 'Ask the customer for a valid phone number' });
    const svc = findService(await listServices(ctx.salon.id), service);
    if (!svc) return fail('unknown_service', { hint: 'Call get_services and pass a service id' });
    const [, date, time] = slot.match(slotRe)!;
    const range = checkDateRange(date, ctx);
    if (range) return range;

    const day = await daySlots(ctx, svc, date);
    const chosen = day.slots.find((s) => s.time === time);
    if (!chosen) {
      return fail('slot_not_available', {
        free_times_that_day: day.slots.map((s) => s.time),
        next_available: day.slots.length ? undefined : await nextAvailableDays(ctx, svc, date, 3),
      });
    }

    const staff = await listStaff(ctx.salon.id);
    const order = preferBarber(chosen.freeStaffIds, staff, barber);
    for (const staffId of order) {
      try {
        const code = bookingCode();
        await ctx.sql`
          insert into bookings (code, salon_id, staff_id, service_id, conversation_id, customer_name,
                                customer_phone, starts_at, ends_at, price, source)
          values (${code}, ${ctx.salon.id}, ${staffId}, ${svc.id}, ${ctx.conversationId}, ${name.trim()},
                  ${normalizedPhone}, ${chosen.startsAt}, ${chosen.endsAt}, ${svc.price}, 'agent')`;
        await ctx.sql`update conversations set customer_name = ${name.trim()}, customer_phone = ${normalizedPhone}
                      where id = ${ctx.conversationId}`;
        return {
          ok: true,
          data: {
            booking_code: code,
            service_bg: svc.name_bg,
            service_en: svc.name_en,
            date,
            weekday_bg: BG_WEEKDAYS[weekdayOf(date)],
            time,
            barber: staff.find((s) => s.id === staffId)?.name,
            price: svc.price,
            currency: ctx.salon.currency,
          },
        };
      } catch (e) {
        // 23P01 = exclusion constraint: someone booked this barber a moment ago. Try the next one.
        if (isOverlapError(e)) continue;
        throw e;
      }
    }
    return fail('slot_just_taken', { hint: 'Check availability again and offer another time' });
  },

  async cancel_or_reschedule({ booking_id, phone, new_slot }, ctx) {
    const [booking] = await ctx.sql`
      select b.*, s.name_bg, s.name_en, s.duration_min from bookings b join services s on s.id = b.service_id
      where b.salon_id = ${ctx.salon.id} and b.code = ${booking_id.trim().toUpperCase()}`;
    // Same answer for "no such code" and "wrong phone", so codes cannot be probed.
    if (!booking || booking.customer_phone !== normalizePhone(phone)) {
      return fail('booking_not_found', { hint: 'Ask the customer to check the code and the phone number' });
    }
    if (booking.status !== 'confirmed') return fail('booking_already_cancelled');
    if (booking.starts_at.getTime() < ctx.now.getTime()) return fail('booking_in_the_past');

    if (!new_slot) {
      await ctx.sql`update bookings set status = 'cancelled', updated_at = now() where id = ${booking.id}`;
      return { ok: true, data: { cancelled: true, booking_code: booking.code } };
    }

    const [, date, time] = new_slot.match(slotRe)!;
    const range = checkDateRange(date, ctx);
    if (range) return range;
    const svc: Service = { id: booking.service_id, name_bg: booking.name_bg, name_en: booking.name_en, duration_min: booking.duration_min, price: booking.price };
    // Ignore the booking being moved, so it can shift by e.g. 30 minutes onto itself.
    const day = await daySlots(ctx, svc, date, booking.id);
    const chosen = day.slots.find((s) => s.time === time);
    if (!chosen) return fail('slot_not_available', { free_times_that_day: day.slots.map((s) => s.time) });

    // Keep the same barber if possible.
    const order = [booking.staff_id, ...chosen.freeStaffIds].filter((id, i, a) => chosen.freeStaffIds.includes(id) && a.indexOf(id) === i);
    for (const staffId of order) {
      try {
        await ctx.sql`update bookings set starts_at = ${chosen.startsAt}, ends_at = ${chosen.endsAt},
                      staff_id = ${staffId}, reminder_sent_at = null, updated_at = now() where id = ${booking.id}`;
        const staff = await listStaff(ctx.salon.id);
        return {
          ok: true,
          data: {
            rescheduled: true,
            booking_code: booking.code,
            date,
            weekday_bg: BG_WEEKDAYS[weekdayOf(date)],
            time,
            barber: staff.find((s) => s.id === staffId)?.name,
          },
        };
      } catch (e) {
        if (isOverlapError(e)) continue;
        throw e;
      }
    }
    return fail('slot_just_taken', { hint: 'Check availability again and offer another time' });
  },

  async handoff_to_human({ reason }, ctx) {
    await ctx.sql`update conversations set handoff = true, handoff_reason = ${reason} where id = ${ctx.conversationId}`;
    return {
      ok: true,
      data: {
        flagged: true,
        salon_phone: ctx.salon.phone,
        note: 'A staff member will see this conversation. Tell the customer they can also call the salon phone.',
      },
    };
  },
};

// ── Helpers ────────────────────────────────────────────────────────────────────

/** Free slots for one service on one date. `ignoreBookingId` is used when rescheduling. */
async function daySlots(ctx: ToolContext, svc: Service, date: string, ignoreBookingId?: string) {
  const tz = ctx.salon.timezone;
  const hours = (await listHours(ctx.salon.id)).find((h) => h.weekday === weekdayOf(date)) ?? null;
  const staff = await listStaff(ctx.salon.id);
  const dayStart = fromLocal(date, '00:00', tz);
  const dayEnd = fromLocal(addDays(date, 1), '00:00', tz);
  const rows = await ctx.sql`
    select id, staff_id, starts_at, ends_at from bookings
    where salon_id = ${ctx.salon.id} and status = 'confirmed'
      and starts_at < ${dayEnd} and ends_at > ${dayStart}`;
  const busy: Busy[] = rows
    .filter((r) => r.id !== ignoreBookingId)
    .map((r) => ({ staffId: r.staff_id, start: r.starts_at, end: r.ends_at }));

  const slots = computeSlots({
    date,
    hours,
    durationMin: svc.duration_min,
    stepMin: ctx.salon.slot_step_min,
    staffIds: staff.map((s) => s.id),
    busy,
    tz,
    now: ctx.now,
    minLeadMin: ctx.salon.min_lead_min,
  });
  return { closed: !hours, hours, slots };
}

async function nextAvailableDays(ctx: ToolContext, svc: Service, fromDate: string, count: number) {
  const found: { date: string; weekday_bg: string; first_free_times: string[] }[] = [];
  for (let i = 1; i <= 14 && found.length < count; i++) {
    const date = addDays(fromDate, i);
    if (checkDateRange(date, ctx)) break;
    const { slots } = await daySlots(ctx, svc, date);
    if (slots.length) found.push({ date, weekday_bg: BG_WEEKDAYS[weekdayOf(date)], first_free_times: slots.slice(0, 4).map((s) => s.time) });
  }
  return found;
}

/** Rejects dates in the past or too far ahead. Returns null when the date is fine. */
function checkDateRange(date: string, ctx: ToolContext): ToolResult | null {
  const today = toLocal(ctx.now, ctx.salon.timezone).date;
  if (isNaN(Date.parse(date))) return fail('invalid_date');
  if (date < today) return fail('date_in_the_past', { today });
  if (date > addDays(today, ctx.salon.max_days_ahead)) return fail('date_too_far_ahead', { latest: addDays(today, ctx.salon.max_days_ahead) });
  return null;
}

function preferBarber(freeIds: string[], staff: { id: string; name: string }[], barber?: string | null) {
  if (!barber) return freeIds;
  const wanted = staff.find((s) => s.name.toLowerCase().startsWith(barber.trim().toLowerCase().slice(0, 3)));
  if (!wanted || !freeIds.includes(wanted.id)) return freeIds;
  return [wanted.id, ...freeIds.filter((id) => id !== wanted.id)];
}

/** Normalizes Bulgarian numbers to +359XXXXXXXXX. Accepts other international numbers too. */
export function normalizePhone(raw: string): string | null {
  let p = raw.replace(/[\s\-().\/]/g, '');
  if (p.startsWith('00')) p = '+' + p.slice(2);
  if (/^0\d{8,9}$/.test(p)) p = '+359' + p.slice(1); // 0888123456 -> +359888123456
  if (/^359\d{8,9}$/.test(p)) p = '+' + p;
  return /^\+\d{8,15}$/.test(p) ? p : null;
}

/** Short, readable booking code (no 0/O/1/I to avoid confusion over the phone). */
function bookingCode(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return Array.from({ length: 6 }, () => alphabet[randomInt(alphabet.length)]).join('');
}

function isOverlapError(e: unknown): boolean {
  return typeof e === 'object' && e !== null && (e as { code?: string }).code === '23P01';
}
