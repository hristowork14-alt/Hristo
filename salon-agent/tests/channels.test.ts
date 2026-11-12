// Phase 2: Telegram webhook, widget history, missed-lead follow-ups, 24h reminders, cron auth.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { POST as telegramPOST } from '../src/app/api/telegram/route';
import { GET as cronGET } from '../src/app/api/cron/route';
import { GET as historyGET } from '../src/app/api/chat/history/route';
import { handleChat, setDefaultModel } from '../src/lib/agent';
import { sendFollowups, sendReminders } from '../src/lib/jobs';
import { runTool } from '../src/lib/tools';
import { fromLocal } from '../src/lib/time';
import { insertBooking, NOW, resetDb, scriptedModel } from './helpers';

let env: Awaited<ReturnType<typeof resetDb>>;
let telegramCalls: { method: string; body: { chat_id: string; text?: string } }[];
const HOUR = 3600_000;

beforeEach(async () => {
  env = await resetDb();
  process.env.TELEGRAM_BOT_TOKEN = 'test-token';
  process.env.TELEGRAM_WEBHOOK_SECRET = 'hook-secret';
  process.env.CRON_SECRET = 'cron-secret';
  telegramCalls = [];
  // Intercept calls to the Telegram API; nothing leaves the machine.
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
    const m = String(url).match(/api\.telegram\.org\/bottest-token\/(\w+)/);
    if (!m) throw new Error(`unexpected fetch ${url}`);
    telegramCalls.push({ method: m[1], body: JSON.parse(String(init?.body)) });
    return new Response('{"ok":true}', { status: 200 });
  });
});
afterEach(() => {
  vi.restoreAllMocks();
  setDefaultModel(null);
});

const tgUpdate = (update_id: number, text: string | undefined, chatId = 4242) =>
  new Request('http://x/api/telegram', {
    method: 'POST',
    headers: { 'x-telegram-bot-api-secret-token': 'hook-secret' },
    body: JSON.stringify({ update_id, message: { message_id: 1, chat: { id: chatId }, text } }),
  });

describe('Telegram webhook', () => {
  it('rejects calls without the secret', async () => {
    const res = await telegramPOST(new Request('http://x', { method: 'POST', body: '{}' }));
    expect(res.status).toBe(401);
  });

  it('answers /start, then runs the same agent for a normal message, once per update', async () => {
    await telegramPOST(tgUpdate(1, '/start'));
    expect(telegramCalls[0].body.text).toMatch(/Здравейте/);

    setDefaultModel(scriptedModel([{ tools: [{ name: 'get_services', input: {} }] }, { text: 'Мъжко подстригване е 15 €.' }]).model);
    await telegramPOST(tgUpdate(2, 'Колко е подстригването?'));
    await telegramPOST(tgUpdate(2, 'Колко е подстригването?')); // Telegram retry -> ignored
    const sends = telegramCalls.filter((c) => c.method === 'sendMessage');
    expect(sends.map((c) => c.body.text)).toEqual([expect.stringMatching(/Здравейте/), 'Мъжко подстригване е 15 €.']);
    expect(telegramCalls.some((c) => c.method === 'sendChatAction')).toBe(true);
    const [conv] = await env.sql`select channel, external_id from conversations`;
    expect(conv).toEqual({ channel: 'telegram', external_id: '4242' });
  });

  it('asks for text when a voice note or photo arrives', async () => {
    await telegramPOST(tgUpdate(3, undefined));
    expect(telegramCalls[0].body.text).toMatch(/текст/);
  });
});

describe('web chat history (widget reopen)', () => {
  it('returns the visible lines of a session only', async () => {
    await handleChat({ salonId: env.salon.id, channel: 'web', externalId: 'web-session-1', text: 'Здравейте', now: NOW, model: scriptedModel([{ text: 'Здравейте! С какво да помогна?' }]).model });
    const res = await historyGET(new Request('http://x/api/chat/history?session_id=web-session-1'));
    expect((await res.json()).messages).toEqual([{ from: 'me', text: 'Здравейте' }, { from: 'agent', text: 'Здравейте! С какво да помогна?' }]);
    const other = await historyGET(new Request('http://x/api/chat/history?session_id=web-session-2'));
    expect((await other.json()).messages).toEqual([]);
  });
});

/** A conversation where the customer looked at prices/times at `lastAt` and then went quiet. */
async function lead(externalId: string, channel: 'web' | 'telegram', lastAt: Date, text = 'Колко струва подстригване?') {
  const [c] = await env.sql`insert into conversations (salon_id, channel, external_id, last_message_at)
                            values (${env.salon.id}, ${channel}, ${externalId}, ${lastAt}) returning *`;
  await env.sql`insert into messages (conversation_id, role, content, text) values (${c.id}, 'user', ${env.sql.json([{ type: 'text', text }])}, ${text})`;
  await runTool('get_services', {}, { sql: env.sql, salon: env.salon, conversationId: c.id, now: lastAt });
  return c;
}

describe('missed-lead follow-up', () => {
  it('nudges once, 2h+ after an unbooked enquiry; skips booked, handed-off, recent and stale ones', async () => {
    const tg = await lead('111', 'telegram', new Date(NOW.getTime() - 3 * HOUR));
    const web = await lead('web-abc12345', 'web', new Date(NOW.getTime() - 5 * HOUR));
    const en = await lead('222', 'telegram', new Date(NOW.getTime() - 3 * HOUR), 'How much is a haircut?');
    const recent = await lead('333', 'telegram', new Date(NOW.getTime() - 1 * HOUR));
    const stale = await lead('444', 'telegram', new Date(NOW.getTime() - 30 * HOUR));
    const booked = await lead('555', 'telegram', new Date(NOW.getTime() - 3 * HOUR));
    await runTool('book_appointment', { name: 'Иво', phone: '0888111222', service: env.services[0].id, slot: '2026-11-17 10:00' }, { sql: env.sql, salon: env.salon, conversationId: booked.id, now: NOW });
    const handed = await lead('666', 'telegram', new Date(NOW.getTime() - 3 * HOUR));
    await env.sql`update conversations set handoff = true where id = ${handed.id}`;

    const first = await sendFollowups(env.sql, NOW);
    expect(first).toEqual({ candidates: 3, sent: 3 });
    const pushed = telegramCalls.map((c) => [c.body.chat_id, c.body.text]).sort((a, b) => String(a[0]).localeCompare(String(b[0])));
    expect(pushed).toEqual([
      ['111', expect.stringMatching(/^Здравейте! По-рано разглеждахте свободни часове в Барбър Студио Витоша/)],
      ['222', expect.stringMatching(/^Hi! Earlier you were looking at times/)],
    ]);
    // Web: stored in the history, so the widget shows it when reopened.
    const res = await historyGET(new Request('http://x/api/chat/history?session_id=web-abc12345'));
    expect((await res.json()).messages.at(-1).text).toMatch(/Да ви запазя ли час/);

    expect(await sendFollowups(env.sql, NOW)).toEqual({ candidates: 0, sent: 0 }); // only once
    const flags = await env.sql`select external_id, followup_channel from conversations where followup_sent_at is not null order by external_id`;
    expect(flags.map((f) => [f.external_id, f.followup_channel])).toEqual([['111', 'telegram'], ['222', 'telegram'], ['web-abc12345', 'web']]);
    void [tg, web, en, recent, stale];
  });
});

describe('24h booking reminder', () => {
  it('reminds bookings made days ahead, not ones made today; Telegram gets a push', async () => {
    const tgConv = await lead('777', 'telegram', new Date(NOW.getTime() - 72 * HOUR));
    const svc = env.svc('Подстригване и брада');
    // Booked 3 days ago through Telegram for tomorrow 10:00 (= 26h after NOW).
    await env.sql`insert into bookings (code, salon_id, staff_id, service_id, conversation_id, customer_name, customer_phone, starts_at, ends_at, price, created_at, updated_at)
      values ('REM234', ${env.salon.id}, ${env.staff[0].id}, ${svc.id}, ${tgConv.id}, 'Петър', '+359888000111',
              ${fromLocal('2026-11-17', '10:00', 'Europe/Sofia')}, ${fromLocal('2026-11-17', '11:00', 'Europe/Sofia')}, 25,
              ${new Date(NOW.getTime() - 72 * HOUR)}, ${new Date(NOW.getTime() - 72 * HOUR)})`;
    // Booked 23h before its start (same moment the job runs) -> no reminder needed.
    await insertBooking({ salonId: env.salon.id, staffId: env.staff[1].id, serviceId: svc.id, date: '2026-11-17', time: '10:00', minutes: 60, code: 'NEW234' });
    await env.sql`update bookings set created_at = ${new Date(NOW.getTime() + 3 * HOUR)}, updated_at = ${new Date(NOW.getTime() + 3 * HOUR)} where code = 'NEW234'`;

    expect(await sendReminders(env.sql, NOW)).toEqual({ due: 0, sent: 0 }); // 26h away: too early
    const later = new Date(NOW.getTime() + 3 * HOUR); // now 23h before
    expect(await sendReminders(env.sql, later)).toEqual({ due: 1, sent: 1 });
    expect(telegramCalls[0].body).toMatchObject({ chat_id: '777' });
    expect(telegramCalls[0].body.text).toBe(
      `Напомняне: вторник в 10:00 ч. имате час за Подстригване и брада при ${env.staff[0].name} в Барбър Студио Витоша (ул. Витоша 1, София). Код: REM234. Ако трябва да промените часа, просто ми пишете тук.`,
    );
    expect(await sendReminders(env.sql, later)).toEqual({ due: 0, sent: 0 }); // only once
  });
});

describe('cron endpoint', () => {
  it('requires the secret and runs both jobs', async () => {
    expect((await cronGET(new Request('http://x/api/cron'))).status).toBe(401);
    const res = await cronGET(new Request('http://x/api/cron', { headers: { authorization: 'Bearer cron-secret' } }));
    expect(await res.json()).toEqual({ followups: { candidates: 0, sent: 0 }, reminders: { due: 0, sent: 0 } });
  });
});
