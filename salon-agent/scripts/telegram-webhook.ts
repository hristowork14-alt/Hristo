// Registers the Telegram webhook (run once after deploying):
//   APP_URL=https://your-app.vercel.app npm run telegram:webhook
// Needs TELEGRAM_BOT_TOKEN and TELEGRAM_WEBHOOK_SECRET in the environment / .env.local.
import { loadEnv } from './load-env';

loadEnv();
const token = process.env.TELEGRAM_BOT_TOKEN;
const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
const appUrl = process.env.APP_URL;
if (!token || !secret || !appUrl) {
  console.error('Set TELEGRAM_BOT_TOKEN, TELEGRAM_WEBHOOK_SECRET and APP_URL first.');
  process.exit(1);
}
const res = await fetch(`https://api.telegram.org/bot${token}/setWebhook`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ url: `${appUrl.replace(/\/$/, '')}/api/telegram`, secret_token: secret, allowed_updates: ['message'] }),
});
console.log(res.status, await res.text());
