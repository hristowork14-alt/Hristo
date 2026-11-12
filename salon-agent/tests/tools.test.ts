// Tool handlers against a real Postgres: rules, the double-booking constraint, logging.
import { beforeEach, describe, expect, it } from 'vitest';
import { runTool, type ToolContext } from '../src/lib/tools';
import { insertBooking, NOW, resetDb } from './helpers';

let env: Awaited<ReturnType<typeof resetDb>>;
let ctx: ToolContext;

beforeEach(async () => {
  env = await resetDb();
  const [conv] = await env.sql`insert into conversations (salon_id, channel, external_id) values (${env.salon.id}, 'test', 't1') returning id`;
  ctx = { sql: env.sql, salon: env.salon, conversationId: conv.id, now: NOW };
});

describe('double-booking protection (database constraint)', () => {
  it('rejects an overlapping booking for the same barber, allows back-to-back ones', async () => {
    const o = { salonId: env.salon.id, staffId: env.staff[0].id, serviceId: env.services[0].id, date: '2026-11-17', minutes: 30 };
    await insertBooking({ ...o, time: '10:00' });
    await expect(insertBooking({ ...o, time: '10:15' })).rejects.toMatchObject({ code: '23P01' });
    await expect(insertBooking({ ...o, time: '10:30' })).resolves.toBeTruthy(); // touches, no overlap
    await expect(insertBooking({ ...o, time: '10:00', staffId: env.staff[1].id })).resolves.toBeTruthy(); // other barber
  });

  it('a cancelled booking frees its time', async () => {
    const o = { salonId: env.salon.id, staffId: env.staff[0].id, serviceId: env.services[0].id, date: '2026-11-17', time: '10:00', minutes: 30 };
    const b = await insertBooking(o);
    await env.sql`update bookings set status = 'cancelled' where id = ${b.id}`;
    await expect(insertBooking(o)).resolves.toBeTruthy();
  });

  it('three customers racing for the same time: exactly two get it (two barbers)', async () => {
    const book = (n: number) =>
      runTool('book_appointment', { name: `Клиент ${n}`, phone: `08881000${n}0`, service: env.svc('Мъжко подстригване').id, slot: '2026-11-17 11:00' }, ctx);
    const results = await Promise.all([book(1), book(2), book(3)]);
    expect(results.filter((r) => r.ok)).toHaveLength(2);
    const [{ n }] = await env.sql`select count(*)::int as n from bookings where status = 'confirmed'`;
    expect(n).toBe(2);
  });
});

describe('get_services / check_availability', () => {
  it('returns prices from the database, and owner edits show up immediately', async () => {
    let r = await runTool('get_services', {}, ctx);
    expect(r.data.services).toHaveLength(5);
    expect((r.data.services as { name_bg: string; price: number }[]).find((s) => s.name_bg === 'Мъжко подстригване')!.price).toBe(15);
    await env.sql`update services set price = 17 where id = ${env.svc('Мъжко подстригване').id}`;
    r = await runTool('get_services', {}, ctx);
    expect((r.data.services as { name_bg: string; price: number }[]).find((s) => s.name_bg === 'Мъжко подстригване')!.price).toBe(17);
  });

  it('lists free times and hides taken ones', async () => {
    const svc = env.svc('Мъжко подстригване');
    for (const st of env.staff) await insertBooking({ salonId: env.salon.id, staffId: st.id, serviceId: svc.id, date: '2026-11-17', time: '15:00', minutes: 30 });
    const r = await runTool('check_availability', { service: svc.id, date: '2026-11-17' }, ctx);
    const times = r.data.free_times as string[];
    expect(times[0]).toBe('09:00');
    expect(times.at(-1)).toBe('18:30');
    expect(times).not.toContain('15:00');
    expect(times).toContain('15:30');
  });

  it('Sunday is closed and the next open days are suggested', async () => {
    const r = await runTool('check_availability', { service: env.svc('Оформяне на брада').id, date: '2026-11-22' }, ctx);
    expect(r.data.closed).toBe(true);
    expect(r.data.free_times).toEqual([]);
    expect((r.data.next_available as { date: string }[])[0].date).toBe('2026-11-23');
  });

  it('rejects past dates and unknown services; accepts a service name instead of id', async () => {
    expect((await runTool('check_availability', { service: env.services[0].id, date: '2026-11-10' }, ctx)).data.error).toBe('date_in_the_past');
    expect((await runTool('check_availability', { service: 'маникюр', date: '2026-11-17' }, ctx)).data.error).toBe('unknown_service');
    expect((await runTool('check_availability', { service: 'брада', date: '2026-11-17' }, ctx)).ok).toBe(true);
  });
});

describe('book_appointment', () => {
  it('books, stores price snapshot and customer, prefers the requested barber', async () => {
    const r = await runTool('book_appointment', { name: 'Петър', phone: '0888 123 456', service: env.svc('Подстригване и брада').id, slot: '2026-11-17 16:00', barber: 'Георги' }, ctx);
    expect(r.ok).toBe(true);
    expect(r.data).toMatchObject({ time: '16:00', barber: 'Георги', price: 25, currency: 'EUR' });
    const [b] = await env.sql`select * from bookings where code = ${r.data.booking_code as string}`;
    expect(b).toMatchObject({ customer_phone: '+359888123456', price: 25, source: 'agent', status: 'confirmed' });
    expect(b.ends_at.getTime() - b.starts_at.getTime()).toBe(60 * 60_000);
    const [c] = await env.sql`select customer_name from conversations where id = ${ctx.conversationId}`;
    expect(c.customer_name).toBe('Петър');
  });

  it('refuses times outside opening hours, off the grid, too soon, or with a bad phone', async () => {
    const svc = env.svc('Мъжко подстригване').id;
    const book = (slot: string, phone = '0888123456') => runTool('book_appointment', { name: 'Ана', phone, service: svc, slot }, ctx);
    expect((await book('2026-11-17 19:00')).data.error).toBe('slot_not_available'); // closing time
    expect((await book('2026-11-17 10:10')).data.error).toBe('slot_not_available'); // not on the 30-min grid
    expect((await book('2026-11-16 08:30')).data.error).toBe('slot_not_available'); // < 60 min from now
    expect((await book('2026-11-22 11:00')).data.error).toBe('slot_not_available'); // Sunday
    expect((await book('2026-11-17 11:00', '123')).data.error).toBe('invalid_phone');
    const [{ n }] = await env.sql`select count(*)::int as n from bookings`;
    expect(n).toBe(0);
  });

  it('invalid input from the model is rejected before touching the database', async () => {
    const r = await runTool('book_appointment', { name: 'А', slot: 'утре' }, ctx);
    expect(r.ok).toBe(false);
    expect(r.data.error).toBe('invalid_input');
  });
});

describe('cancel_or_reschedule', () => {
  it('needs the matching phone, then moves the booking (keeping the barber when free)', async () => {
    const svc = env.svc('Мъжко подстригване');
    const b = await insertBooking({ salonId: env.salon.id, staffId: env.staff[1].id, serviceId: svc.id, date: '2026-11-17', time: '10:00', minutes: 30, phone: '+359888555666', code: 'ABC234' });

    const wrong = await runTool('cancel_or_reschedule', { booking_id: 'abc234', phone: '0899999999', new_slot: '2026-11-18 12:00' }, ctx);
    expect(wrong.data.error).toBe('booking_not_found');

    const moved = await runTool('cancel_or_reschedule', { booking_id: 'abc234', phone: '0888 555 666', new_slot: '2026-11-18 12:00' }, ctx);
    expect(moved.ok).toBe(true);
    const [after] = await env.sql`select * from bookings where id = ${b.id}`;
    expect(after.staff_id).toBe(env.staff[1].id);
    expect(after.starts_at.toISOString()).toBe('2026-11-18T10:00:00.000Z'); // 12:00 Sofia
  });

  it('can shift a booking by 30 minutes onto its own time, and cancels', async () => {
    const svc = env.svc('Подстригване и брада');
    await insertBooking({ salonId: env.salon.id, staffId: env.staff[0].id, serviceId: svc.id, date: '2026-11-17', time: '10:00', minutes: 60, phone: '+359888555666', code: 'XYZ789' });
    await insertBooking({ salonId: env.salon.id, staffId: env.staff[1].id, serviceId: svc.id, date: '2026-11-17', time: '10:00', minutes: 120 });
    const r = await runTool('cancel_or_reschedule', { booking_id: 'XYZ789', phone: '0888555666', new_slot: '2026-11-17 10:30' }, ctx);
    expect(r.ok).toBe(true);
    const c = await runTool('cancel_or_reschedule', { booking_id: 'XYZ789', phone: '0888555666' }, ctx);
    expect(c.data.cancelled).toBe(true);
    const again = await runTool('cancel_or_reschedule', { booking_id: 'XYZ789', phone: '0888555666' }, ctx);
    expect(again.data.error).toBe('booking_already_cancelled');
  });
});

describe('logging and handoff', () => {
  it('every tool call is written to tool_calls', async () => {
    await runTool('get_services', {}, ctx);
    await runTool('handoff_to_human', { reason: 'Клиентът пита за алергии' }, ctx);
    await runTool('nonexistent_tool', {}, ctx);
    const rows = await env.sql`select tool, is_error from tool_calls order by id`;
    expect(rows.map((r) => [r.tool, r.is_error])).toEqual([['get_services', false], ['handoff_to_human', false], ['nonexistent_tool', true]]);
    const [c] = await env.sql`select handoff, handoff_reason from conversations where id = ${ctx.conversationId}`;
    expect(c).toEqual({ handoff: true, handoff_reason: 'Клиентът пита за алергии' });
  });
});
