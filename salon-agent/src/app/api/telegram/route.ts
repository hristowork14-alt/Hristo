// Telegram bot webhook: POST /api/telegram
// Telegram calls this for every message the bot receives. Register it once with
//   npm run telegram:webhook   (see README)
// Each Telegram chat is its own conversation; the same agent answers.
import { NextResponse } from 'next/server';
import { handleChat } from '@/lib/agent';
import { getSql } from '@/lib/db';
import { telegramSend, telegramTyping } from '@/lib/telegram';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60; // the agent may call several tools

export async function POST(req: Request) {
  // Telegram echoes the secret we gave it when registering the webhook.
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (!secret || req.headers.get('x-telegram-bot-api-secret-token') !== secret) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const update = await req.json().catch(() => null);
  const msg = update?.message;
  if (!update?.update_id || !msg?.chat?.id) return NextResponse.json({ ok: true }); // edits, joins... ignored

  // Telegram retries slow answers: handle each update only once.
  const [fresh] = await getSql()`insert into telegram_updates (update_id) values (${update.update_id})
                                 on conflict do nothing returning update_id`;
  if (!fresh) return NextResponse.json({ ok: true, duplicate: true });

  const chatId = String(msg.chat.id);
  const text: string | undefined = msg.text?.trim();

  if (!text) {
    await telegramSend(chatId, 'Моля, пишете ми с текст 🙂 / Please send me a text message.');
    return NextResponse.json({ ok: true });
  }
  if (text === '/start') {
    await telegramSend(chatId, 'Здравейте! Аз съм онлайн рецепцията на салона. Мога да ви кажа цени и свободни часове и да ви запиша. С какво да помогна?\n\nHi! I can tell you prices and free times and book you in. How can I help?');
    return NextResponse.json({ ok: true });
  }

  await telegramTyping(chatId);
  try {
    const out = await handleChat({
      salonSlug: process.env.TELEGRAM_SALON_SLUG || undefined,
      channel: 'telegram',
      externalId: chatId,
      text: text.slice(0, 2000),
    });
    await telegramSend(chatId, out.reply);
  } catch (e) {
    console.error('[telegram]', e);
    await telegramSend(chatId, 'Извинете, възникна проблем. Моля, опитайте отново по-късно.');
  }
  return NextResponse.json({ ok: true });
}
