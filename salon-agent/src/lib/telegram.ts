// Minimal Telegram Bot API client (just what we need).
const api = (method: string) => `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/${method}`;

export function telegramConfigured() {
  return !!process.env.TELEGRAM_BOT_TOKEN;
}

export async function telegramSend(chatId: string | number, text: string): Promise<boolean> {
  if (!telegramConfigured()) return false;
  const res = await fetch(api('sendMessage'), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text }),
  });
  if (!res.ok) console.error(JSON.stringify({ at: 'telegram', chatId, status: res.status, body: await res.text() }));
  return res.ok;
}

/** Shows "typing…" in the chat while the agent thinks. Failures are ignored. */
export async function telegramTyping(chatId: string | number) {
  if (!telegramConfigured()) return;
  await fetch(api('sendChatAction'), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, action: 'typing' }),
  }).catch(() => {});
}
