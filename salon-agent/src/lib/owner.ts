// Queries and updates behind the owner dashboard. Every function is scoped to one salon.
import { z } from 'zod';
import { getSql } from './db';
import type { Salon } from './salon';
import { addDays, fromLocal, toLocal } from './time';

// ── Overview: a day's bookings + headline numbers ──────────────────────────────

export async function overview(salon: Salon, date: string | null, now = new Date()) {
  const sql = getSql();
  const tz = salon.timezone;
  const today = toLocal(now, tz);
  const day = date ?? today.date;
  // Week = Monday 00:00 to next Monday 00:00, salon time.
  const monday = addDays(today.date, 1 - today.weekday);
  const weekStart = fromLocal(monday, '00:00', tz);
  const weekEnd = fromLocal(addDays(monday, 7), '00:00', tz);

  const bookings = await sql`
    select b.id, b.code, b.customer_name, b.customer_phone, b.starts_at, b.ends_at, b.price, b.status, b.source,
           s.name_bg as service, st.name as barber, b.conversation_id
    from bookings b join services s on s.id = b.service_id join staff st on st.id = b.staff_id
    where b.salon_id = ${salon.id}
      and b.starts_at >= ${fromLocal(day, '00:00', tz)} and b.starts_at < ${fromLocal(addDays(day, 1), '00:00', tz)}
    order by b.starts_at, st.name`;

  const [stats] = await sql`
    select
      (select count(*)::int from bookings where salon_id = ${salon.id} and status = 'confirmed'
         and starts_at >= ${fromLocal(today.date, '00:00', tz)} and starts_at < ${fromLocal(addDays(today.date, 1), '00:00', tz)}) as today_count,
      (select count(*)::int from bookings where salon_id = ${salon.id} and status = 'confirmed' and source = 'agent'
         and created_at >= ${weekStart} and created_at < ${weekEnd}) as week_agent_count,
      (select coalesce(sum(price), 0)::float from bookings where salon_id = ${salon.id} and status = 'confirmed' and source = 'agent'
         and created_at >= ${weekStart} and created_at < ${weekEnd}) as week_agent_value,
      (select coalesce(sum(price), 0)::float from bookings where salon_id = ${salon.id} and status = 'confirmed'
         and starts_at >= ${weekStart} and starts_at < ${weekEnd}) as week_revenue,
      (select count(*)::int from conversations where salon_id = ${salon.id} and handoff) as open_handoffs`;

  return {
    salon: { name: salon.name, currency: salon.currency, timezone: tz },
    date: day,
    today: today.date,
    week: { from: monday, to: addDays(monday, 6) },
    stats,
    bookings: bookings.map((b) => ({ ...b, time: toLocal(b.starts_at, tz).time, end_time: toLocal(b.ends_at, tz).time })),
  };
}

export async function cancelBooking(salon: Salon, id: string) {
  const [row] = await getSql()`
    update bookings set status = 'cancelled', updated_at = now()
    where id = ${id} and salon_id = ${salon.id} and status = 'confirmed' returning id`;
  return !!row;
}

// ── Conversations ──────────────────────────────────────────────────────────────

export async function listConversations(salon: Salon) {
  return getSql()`
    select c.id, c.channel, c.customer_name, c.customer_phone, c.handoff, c.handoff_reason,
           c.last_message_at, c.created_at, c.followup_sent_at,
           (select text from messages m where m.conversation_id = c.id and m.text is not null and m.text <> ''
              order by m.id desc limit 1) as last_text,
           (select count(*)::int from messages m where m.conversation_id = c.id and m.role = 'user' and m.text is not null) as user_messages,
           exists (select 1 from bookings b where b.conversation_id = c.id) as booked
    from conversations c
    where c.salon_id = ${salon.id}
    order by c.handoff desc, c.last_message_at desc
    limit 100`;
}

/** One conversation: visible messages and tool calls, in time order (for debugging too). */
export async function getConversation(salon: Salon, id: string) {
  const sql = getSql();
  const [conv] = await sql`select * from conversations where id = ${id} and salon_id = ${salon.id}`;
  if (!conv) return null;
  const messages = await sql`
    select 'message' as kind, id, role, text, created_at from messages
    where conversation_id = ${id} and text is not null and text <> '' order by id`;
  const tools = await sql`
    select 'tool' as kind, id, tool, input, output, is_error, duration_ms, created_at from tool_calls
    where conversation_id = ${id} order by id`;
  const timeline = [...messages, ...tools].sort((a, b) => a.created_at.getTime() - b.created_at.getTime() || (a.kind === 'message' ? -1 : 1));
  return { conversation: conv, timeline };
}

export async function resolveHandoff(salon: Salon, id: string) {
  const [row] = await getSql()`update conversations set handoff = false where id = ${id} and salon_id = ${salon.id} returning id`;
  return !!row;
}

// ── Services and prices ────────────────────────────────────────────────────────

export async function listAllServices(salon: Salon) {
  return getSql()`select id, name_bg, name_en, duration_min, price, active from services
                  where salon_id = ${salon.id} order by sort_order, name_bg`;
}

export const ServicesInput = z.object({
  services: z
    .array(
      z.object({
        id: z.string().uuid().optional(),
        name_bg: z.string().trim().min(1).max(80),
        name_en: z.string().trim().min(1).max(80),
        duration_min: z.number().int().min(5).max(480),
        price: z.number().min(0).max(10000),
        active: z.boolean(),
      }),
    )
    .max(100),
});

/** Saves the whole list. Services can't be deleted (old bookings use them); untick "active" instead. */
export async function saveServices(salon: Salon, input: z.infer<typeof ServicesInput>) {
  await getSql().begin(async (tx) => {
    for (const [i, s] of input.services.entries()) {
      if (s.id) {
        await tx`update services set name_bg = ${s.name_bg}, name_en = ${s.name_en}, duration_min = ${s.duration_min},
                 price = ${s.price}, active = ${s.active}, sort_order = ${i}
                 where id = ${s.id} and salon_id = ${salon.id}`;
      } else {
        await tx`insert into services (salon_id, name_bg, name_en, duration_min, price, active, sort_order)
                 values (${salon.id}, ${s.name_bg}, ${s.name_en}, ${s.duration_min}, ${s.price}, ${s.active}, ${i})`;
      }
    }
  });
  return listAllServices(salon);
}

// ── Salon details and opening hours ────────────────────────────────────────────

export async function getSettings(salon: Salon) {
  const hours = await getSql()`
    select weekday, to_char(open_time, 'HH24:MI') as open, to_char(close_time, 'HH24:MI') as close
    from working_hours where salon_id = ${salon.id} order by weekday`;
  return {
    name: salon.name,
    address: salon.address ?? '',
    phone: salon.phone ?? '',
    extra_info: salon.extra_info ?? '',
    hours,
  };
}

const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
export const SettingsInput = z.object({
  name: z.string().trim().min(1).max(100),
  address: z.string().trim().max(200),
  phone: z.string().trim().max(40),
  extra_info: z.string().trim().max(1000),
  hours: z
    .array(z.object({ weekday: z.number().int().min(1).max(7), open: hhmm, close: hhmm }))
    .max(7)
    .refine((h) => h.every((d) => d.open < d.close), 'Closing time must be after opening time')
    .refine((h) => new Set(h.map((d) => d.weekday)).size === h.length, 'Each day only once'),
});

export async function saveSettings(salon: Salon, input: z.infer<typeof SettingsInput>) {
  await getSql().begin(async (tx) => {
    await tx`update salons set name = ${input.name}, address = ${input.address || null}, phone = ${input.phone || null},
             extra_info = ${input.extra_info || null} where id = ${salon.id}`;
    await tx`delete from working_hours where salon_id = ${salon.id}`;
    for (const h of input.hours) {
      await tx`insert into working_hours (salon_id, weekday, open_time, close_time)
               values (${salon.id}, ${h.weekday}, ${h.open}, ${h.close})`;
    }
  });
}
