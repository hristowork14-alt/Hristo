// Scheduled jobs, run by GET /api/cron every ~15 minutes:
//  1. Missed-lead follow-up: someone asked about services/times but didn't book ->
//     ONE friendly nudge 2 hours after their last message.
//  2. Booking reminder ~24 hours before the appointment.
// Both are idempotent: each conversation / booking is marked when handled.
import type { Sql } from './db';
import { telegramSend } from './telegram';
import { BG_WEEKDAYS, EN_WEEKDAYS, toLocal } from './time';

const HOUR = 3600_000;

/** Where a message actually went. */
type Channel = 'telegram' | 'web' | 'none';

/**
 * Sends a message to the customer of a conversation and appends it to the history, so
 * the agent knows what was said if the customer replies ("yes, move it please").
 * Telegram: pushed now. Web: shown when the visitor reopens the chat widget.
 */
export async function deliver(sql: Sql, conv: { id: string; channel: string; external_id: string }, text: string): Promise<Channel> {
  let channel: Channel = 'none';
  if (conv.channel === 'telegram') channel = (await telegramSend(conv.external_id, text)) ? 'telegram' : 'none';
  else if (conv.channel === 'web') channel = 'web';
  if (channel !== 'none') {
    await sql`insert into messages (conversation_id, role, content, text)
              values (${conv.id}, 'assistant', ${sql.json([{ type: 'text', text }])}, ${text})`;
  }
  return channel;
}

/** Language of the customer, guessed from their messages (Cyrillic -> Bulgarian). */
async function customerLanguage(sql: Sql, conversationId: string | null): Promise<'bg' | 'en'> {
  if (!conversationId) return 'bg';
  const rows = await sql`select text from messages where conversation_id = ${conversationId}
                         and role = 'user' and text is not null order by id desc limit 3`;
  const sample = rows.map((r) => r.text).join(' ');
  if (!sample) return 'bg';
  const cyr = (sample.match(/[а-яА-Я]/g) ?? []).length;
  const lat = (sample.match(/[a-zA-Z]/g) ?? []).length;
  return lat > cyr * 2 ? 'en' : 'bg';
}

// ── 1. Missed-lead follow-up ───────────────────────────────────────────────────

export async function sendFollowups(sql: Sql, now = new Date()) {
  // Interested (looked at services or times), quiet for 2+ hours (but < 24h, so we never
  // message someone days later), no booking or change made, not handed to a human.
  const leads = await sql`
    select c.id, c.channel, c.external_id, c.customer_name, s.name as salon_name
    from conversations c join salons s on s.id = c.salon_id
    where c.followup_sent_at is null
      and c.handoff = false
      and c.channel in ('web', 'telegram')
      and c.last_message_at <= ${new Date(now.getTime() - 2 * HOUR)}
      and c.last_message_at >  ${new Date(now.getTime() - 24 * HOUR)}
      and exists (select 1 from tool_calls t where t.conversation_id = c.id
                  and t.tool in ('get_services', 'check_availability'))
      and not exists (select 1 from bookings b where b.conversation_id = c.id)
      and not exists (select 1 from tool_calls t where t.conversation_id = c.id
                      and t.tool = 'cancel_or_reschedule' and not t.is_error)`;

  let sent = 0;
  for (const lead of leads) {
    const lang = await customerLanguage(sql, lead.id);
    const name = lead.customer_name ? ` ${lead.customer_name}` : '';
    const text =
      lang === 'bg'
        ? `Здравейте${name}! По-рано разглеждахте свободни часове в ${lead.salon_name}. Да ви запазя ли час? Напишете ми кой ден и час ви е удобен.`
        : `Hi${name}! Earlier you were looking at times at ${lead.salon_name}. Shall I book one for you? Just tell me which day and time suits you.`;
    // Mark first, so a crash halfway can never send the same nudge twice.
    const [claimed] = await sql`update conversations set followup_sent_at = ${now}
                                where id = ${lead.id} and followup_sent_at is null returning id`;
    if (!claimed) continue;
    const channel = await deliver(sql, { id: lead.id, channel: lead.channel, external_id: lead.external_id }, text);
    await sql`update conversations set followup_channel = ${channel} where id = ${lead.id}`;
    console.log(JSON.stringify({ at: 'job', job: 'followup', conversation: lead.id, channel }));
    if (channel !== 'none') sent++;
  }
  return { candidates: leads.length, sent };
}

// ── 2. Booking reminder 24h before ─────────────────────────────────────────────

export async function sendReminders(sql: Sql, now = new Date()) {
  // Appointments starting within the next 24 hours that were booked (or last moved) more
  // than 24 hours before their start — no "reminder" right after someone just booked.
  const due = await sql`
    select b.id, b.code, b.starts_at, b.conversation_id, st.name as barber,
           sv.name_bg, sv.name_en, sa.name as salon_name, sa.address, sa.timezone,
           c.channel, c.external_id
    from bookings b
    join services sv on sv.id = b.service_id
    join staff st on st.id = b.staff_id
    join salons sa on sa.id = b.salon_id
    left join conversations c on c.id = b.conversation_id
    where b.status = 'confirmed' and b.reminder_sent_at is null
      and b.starts_at > ${now} and b.starts_at <= ${new Date(now.getTime() + 24 * HOUR)}
      and b.updated_at <= b.starts_at - interval '24 hours'`;

  let sent = 0;
  for (const b of due) {
    const [claimed] = await sql`update bookings set reminder_sent_at = ${now}
                                where id = ${b.id} and reminder_sent_at is null returning id`;
    if (!claimed) continue;
    const local = toLocal(b.starts_at, b.timezone);
    const lang = await customerLanguage(sql, b.conversation_id);
    const where = b.address ? ` (${b.address})` : '';
    const text =
      lang === 'bg'
        ? `Напомняне: ${BG_WEEKDAYS[local.weekday]} в ${local.time} ч. имате час за ${b.name_bg} при ${b.barber} в ${b.salon_name}${where}. Код: ${b.code}. Ако трябва да промените часа, просто ми пишете тук.`
        : `Reminder: you have a ${b.name_en} with ${b.barber} at ${b.salon_name}${where} on ${EN_WEEKDAYS[local.weekday]} at ${local.time}. Code: ${b.code}. If you need to change it, just message me here.`;
    const channel: Channel = b.conversation_id
      ? await deliver(sql, { id: b.conversation_id, channel: b.channel, external_id: b.external_id }, text)
      : 'none';
    await sql`update bookings set reminder_channel = ${channel} where id = ${b.id}`;
    console.log(JSON.stringify({ at: 'job', job: 'reminder', booking: b.code, channel }));
    if (channel !== 'none') sent++;
  }
  return { due: due.length, sent };
}
