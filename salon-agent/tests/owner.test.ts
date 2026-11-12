// Phase 3: owner dashboard API — auth, numbers, edits that the agent sees immediately.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { GET as overviewGET } from '../src/app/api/owner/overview/route';
import { POST as bookingsPOST } from '../src/app/api/owner/bookings/route';
import { GET as convGET, POST as convPOST } from '../src/app/api/owner/conversations/route';
import { GET as servicesGET, PUT as servicesPUT } from '../src/app/api/owner/services/route';
import { GET as settingsGET, PUT as settingsPUT } from '../src/app/api/owner/settings/route';
import { handleChat } from '../src/lib/agent';
import { setVerifier } from '../src/lib/auth';
import { overview } from '../src/lib/owner';
import { runTool } from '../src/lib/tools';
import { insertBooking, NOW, resetDb, scriptedModel } from './helpers';

let env: Awaited<ReturnType<typeof resetDb>>;

beforeEach(async () => {
  env = await resetDb();
  await env.sql`update salons set owner_email = 'Owner@Example.com' where id = ${env.salon.id}`;
  env.salon.owner_email = 'Owner@Example.com';
  // Fake Supabase: token "owner" = the owner, "stranger" = someone with no salon.
  setVerifier(async (t) => (t === 'owner' ? { id: 'u1', email: 'owner@example.com' } : t === 'stranger' ? { id: 'u2', email: 'x@example.com' } : null));
});
afterEach(() => setVerifier(null));

const req = (path: string, token = 'owner', init: RequestInit = {}) =>
  new Request(`http://x${path}`, { ...init, headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' } });

describe('auth', () => {
  it('401 without a valid token, 403 for a user who owns no salon', async () => {
    expect((await overviewGET(new Request('http://x/api/owner/overview'))).status).toBe(401);
    expect((await overviewGET(req('/api/owner/overview', 'forged'))).status).toBe(401);
    expect((await overviewGET(req('/api/owner/overview', 'stranger'))).status).toBe(403);
    expect((await overviewGET(req('/api/owner/overview'))).status).toBe(200);
  });
});

describe('overview numbers', () => {
  it("today's bookings, agent bookings this week and estimated revenue", async () => {
    const ctx = async (id: string) => {
      const [c] = await env.sql`insert into conversations (salon_id, channel, external_id) values (${env.salon.id}, 'web', ${id}) returning id`;
      return { sql: env.sql, salon: env.salon, conversationId: c.id, now: NOW };
    };
    // Two agent bookings (made "this week" — created_at is the real clock, so pin it to NOW).
    await runTool('book_appointment', { name: 'Ана', phone: '0888000001', service: env.svc('Подстригване и брада').id, slot: '2026-11-16 12:00' }, await ctx('a1'));
    await runTool('book_appointment', { name: 'Боби', phone: '0888000002', service: env.svc('Мъжко подстригване').id, slot: '2026-11-18 12:00' }, await ctx('a2'));
    await env.sql`update bookings set created_at = ${NOW}`;
    // One booking from the dashboard today, and one cancelled.
    const manual = await insertBooking({ salonId: env.salon.id, staffId: env.staff[0].id, serviceId: env.svc('Оформяне на брада').id, date: '2026-11-16', time: '15:00', minutes: 30, price: 10 });
    await env.sql`update bookings set source = 'dashboard' where id = ${manual.id}`;
    const cancelled = await insertBooking({ salonId: env.salon.id, staffId: env.staff[1].id, serviceId: env.services[0].id, date: '2026-11-16', time: '16:00', minutes: 30 });
    await env.sql`update bookings set status = 'cancelled' where id = ${cancelled.id}`;
    // Next week: not in this week's revenue.
    await insertBooking({ salonId: env.salon.id, staffId: env.staff[0].id, serviceId: env.services[0].id, date: '2026-11-24', time: '10:00', minutes: 30 });

    const o = await overview({ ...env.salon }, null, NOW);
    expect(o.week).toEqual({ from: '2026-11-16', to: '2026-11-22' });
    expect(o.stats).toEqual({ today_count: 2, week_agent_count: 2, week_agent_value: 40, week_revenue: 50, open_handoffs: 0 });
    expect(o.bookings.map((b) => [b.time, (b as { status?: string }).status, (b as { source?: string }).source])).toEqual([
      ['12:00', 'confirmed', 'agent'],
      ['15:00', 'confirmed', 'dashboard'],
      ['16:00', 'cancelled', 'agent'],
    ]);
  });

  it('owner can cancel a booking, only in their own salon', async () => {
    const b = await insertBooking({ salonId: env.salon.id, staffId: env.staff[0].id, serviceId: env.services[0].id, date: '2026-11-17', time: '10:00', minutes: 30 });
    expect((await bookingsPOST(req('/api/owner/bookings', 'stranger', { method: 'POST', body: JSON.stringify({ id: b.id, action: 'cancel' }) }))).status).toBe(403);
    expect((await bookingsPOST(req('/api/owner/bookings', 'owner', { method: 'POST', body: JSON.stringify({ id: b.id, action: 'cancel' }) }))).status).toBe(200);
    const [after] = await env.sql`select status from bookings where id = ${b.id}`;
    expect(after.status).toBe('cancelled');
  });
});

describe('conversations', () => {
  it('lists conversations (handoffs first) and shows messages with tool calls', async () => {
    await handleChat({ salonId: env.salon.id, channel: 'web', externalId: 'web-first-123', text: 'Цени?', now: NOW,
      model: scriptedModel([{ tools: [{ name: 'get_services', input: {} }] }, { text: 'Подстригване е 15 €.' }]).model });
    await handleChat({ salonId: env.salon.id, channel: 'telegram', externalId: '999', text: 'Искам човек', now: NOW,
      model: scriptedModel([{ tools: [{ name: 'handoff_to_human', input: { reason: 'Иска човек' } }] }, { text: 'Колега ще ви пише.' }]).model });

    const list = (await (await convGET(req('/api/owner/conversations'))).json()).conversations;
    expect(list.map((c: { channel: string; handoff: boolean; last_text: string }) => [c.channel, c.handoff, c.last_text])).toEqual([
      ['telegram', true, 'Колега ще ви пише.'],
      ['web', false, 'Подстригване е 15 €.'],
    ]);

    const detail = await (await convGET(req(`/api/owner/conversations?id=${list[1].id}`))).json();
    expect(detail.timeline.map((t: { kind: string; role?: string; tool?: string }) => t.tool ?? t.role)).toEqual(['user', 'get_services', 'assistant']);

    await convPOST(req('/api/owner/conversations', 'owner', { method: 'POST', body: JSON.stringify({ id: list[0].id, action: 'resolve' }) }));
    const [c] = await env.sql`select handoff, handoff_reason from conversations where id = ${list[0].id}`;
    expect(c).toEqual({ handoff: false, handoff_reason: 'Иска човек' });
  });
});

describe('editing services and hours: the agent uses the changes immediately', () => {
  it('price change + new service + deactivated service', async () => {
    const { services } = await (await servicesGET(req('/api/owner/services'))).json();
    services[0].price = 16;
    services[3].active = false; // kids' haircut paused
    services.push({ name_bg: 'Боядисване на брада', name_en: 'Beard colouring', duration_min: 30, price: 14, active: true });
    const res = await servicesPUT(req('/api/owner/services', 'owner', { method: 'PUT', body: JSON.stringify({ services }) }));
    expect(res.status).toBe(200);

    // What the agent's tool now returns:
    const [conv] = await env.sql`insert into conversations (salon_id, channel, external_id) values (${env.salon.id}, 'test', 'x') returning id`;
    const r = await runTool('get_services', {}, { sql: env.sql, salon: env.salon, conversationId: conv.id, now: NOW });
    const names = (r.data.services as { name_bg: string; price: number }[]).map((s) => `${s.name_bg} ${s.price}`);
    expect(names).toContain('Мъжко подстригване 16');
    expect(names).toContain('Боядисване на брада 14');
    expect(names.some((n) => n.startsWith('Детско'))).toBe(false);
  });

  it('rejects invalid service data', async () => {
    const bad = { services: [{ name_bg: '', name_en: 'x', duration_min: 2, price: -1, active: true }] };
    expect((await servicesPUT(req('/api/owner/services', 'owner', { method: 'PUT', body: JSON.stringify(bad) }))).status).toBe(400);
  });

  it('hours change reaches the next chat message; bad hours are rejected', async () => {
    const s = await (await settingsGET(req('/api/owner/settings'))).json();
    expect(s.hours).toHaveLength(6);
    s.hours = s.hours.filter((h: { weekday: number }) => h.weekday !== 6); // close on Saturdays
    s.hours.push({ weekday: 7, open: '11:00', close: '15:00' }); // open on Sundays
    expect((await settingsPUT(req('/api/owner/settings', 'owner', { method: 'PUT', body: JSON.stringify(s) }))).status).toBe(200);

    const fake = scriptedModel([{ text: 'ok' }]);
    await handleChat({ salonId: env.salon.id, channel: 'test', externalId: 'h1', text: 'Работите ли в неделя?', now: NOW, model: fake.model });
    expect(fake.requests[0].system).toContain('неделя / Sunday: 11:00-15:00');
    expect(fake.requests[0].system).toContain('събота / Saturday: почивен ден');

    const bad = { ...s, hours: [{ weekday: 1, open: '18:00', close: '09:00' }] };
    expect((await settingsPUT(req('/api/owner/settings', 'owner', { method: 'PUT', body: JSON.stringify(bad) }))).status).toBe(400);
  });
});
