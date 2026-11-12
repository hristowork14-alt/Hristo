// Fills the demo salon with realistic bookings and chats for TODAY and this week, so the
// dashboard has something to show in a sales demo. Run after db:seed:
//   npm run db:demo-data
// It goes through the real tools (so bookings obey every rule) and stores sample chats.
import { createSql, setSql } from '../src/lib/db';
import { DEMO_SLUG } from '../src/lib/seed';
import { getSalonBySlug, listServices } from '../src/lib/salon';
import { runTool } from '../src/lib/tools';
import { addDays, toLocal } from '../src/lib/time';
import { loadEnv } from './load-env';

loadEnv();
const sql = createSql(process.env.DATABASE_URL!);
setSql(sql);

async function main() {
  const salon = (await getSalonBySlug(DEMO_SLUG))!;
  const services = await listServices(salon.id);
  const svc = (bg: string) => services.find((s) => s.name_bg === bg)!.id;
  // "now" = 07:00 today, so today's slots are still bookable when this runs during the day.
  const today = toLocal(new Date(), salon.timezone).date;
  const now = new Date(`${today}T05:00:00Z`);

  const chats: { ext: string; channel: 'web' | 'telegram'; lines: [string, string][]; book?: [string, string, string, string]; handoff?: string; toolsOnly?: boolean }[] = [
    { ext: 'web-demo-1', channel: 'web', lines: [['Здравейте, имате ли час днес следобед за подстригване?', 'Да! Днес имам свободно в 14:00, 15:30 и 17:00. Кой час ви е удобен?'], ['15:30, Петър Иванов, 0888 123 456', 'Готово, Петър! Записах ви днес в 15:30 за мъжко подстригване (15 €). Код за промени: виж по-долу.']], book: ['Петър Иванов', '0888123456', 'Мъжко подстригване', '15:30'] },
    { ext: '501234', channel: 'telegram', lines: [['Колко струва подстригване и брада?', 'Подстригване и брада е 25 € и отнема около 60 минути. Да ви запиша ли?'], ['Да, утре в 11, Георги Петров 0899 222 333', 'Записах ви утре в 11:00 при Иван. До скоро!']], book: ['Георги Петров', '0899222333', 'Подстригване и брада', 'tomorrow 11:00'] },
    { ext: 'web-demo-2', channel: 'web', lines: [['Hi, how much is a hot towel shave?', 'A hot towel shave is 18 € and takes about 45 minutes. Would you like to book one?']], toolsOnly: true },
    { ext: '501999', channel: 'telegram', lines: [['Имам алергия към някои продукти, може ли да говоря с човек?', 'Разбира се. Предадох въпроса ви на колега, който ще ви пише. Можете да се обадите и на +359 888 123 456.']], handoff: 'Клиентът има алергия и иска да говори с човек' },
    { ext: 'web-demo-3', channel: 'web', lines: [['Детско подстригване в събота става ли?', 'В събота работим 10:00–16:00. Имам свободно в 10:30, 12:00 и 14:30.']], toolsOnly: true },
  ];

  for (const c of chats) {
    await sql`delete from conversations where salon_id = ${salon.id} and channel = ${c.channel} and external_id = ${c.ext}`;
    const [conv] = await sql`insert into conversations (salon_id, channel, external_id, last_message_at)
                             values (${salon.id}, ${c.channel}, ${c.ext}, now()) returning id`;
    const ctx = { sql, salon, conversationId: conv.id, now };
    for (const [user, agent] of c.lines) {
      await sql`insert into messages (conversation_id, role, content, text) values (${conv.id}, 'user', ${sql.json([{ type: 'text', text: user }])}, ${user})`;
      if (c.toolsOnly || c.book) await runTool('get_services', {}, ctx);
      await sql`insert into messages (conversation_id, role, content, text) values (${conv.id}, 'assistant', ${sql.json([{ type: 'text', text: agent }])}, ${agent})`;
    }
    if (c.book) {
      const [name, phone, service, when] = c.book;
      const slot = when.startsWith('tomorrow') ? `${addDays(today, 1)} ${when.split(' ')[1]}` : `${today} ${when}`;
      const r = await runTool('book_appointment', { name, phone, service: svc(service), slot }, ctx);
      console.log(`${name}: ${r.ok ? 'booked ' + slot : JSON.stringify(r.data)}`);
    }
    if (c.handoff) await runTool('handoff_to_human', { reason: c.handoff }, ctx);
  }

  // A few more of today's appointments (phone / walk-in), so the day looks real.
  const [{ id: walkinConv }] = await sql`insert into conversations (salon_id, channel, external_id) values (${salon.id}, 'web', ${'web-demo-walkins-' + Date.now()}) returning id`;
  const ctx = { sql, salon, conversationId: walkinConv, now };
  for (const [name, phone, service, time] of [['Николай', '0877111222', 'Оформяне на брада', '10:00'], ['Стефан', '0877333444', 'Бръснене с горещ пешкир', '12:00'], ['Мартин', '0877555666', 'Мъжко подстригване', '17:30']]) {
    const r = await runTool('book_appointment', { name, phone, service: svc(service), slot: `${today} ${time}` }, ctx);
    if (r.ok) await sql`update bookings set source = 'dashboard', conversation_id = null where code = ${r.data.booking_code as string}`;
  }
  await sql`delete from conversations where id = ${walkinConv}`;
  console.log('demo data ready');
}

main().catch((e) => { console.error(e); process.exitCode = 1; }).finally(() => sql.end());
