// Chat with the agent in the terminal (uses DATABASE_URL and ANTHROPIC_API_KEY).
// Usage: npm run chat
import { createInterface } from 'node:readline/promises';
import { handleChat } from '../src/lib/agent';
import { loadEnv } from './load-env';

loadEnv();
const rl = createInterface({ input: process.stdin, output: process.stdout });
const session = 'cli-' + Date.now();
console.log('SalonAgent — пишете на български (Ctrl+C за изход)\n');
for (;;) {
  const text = (await rl.question('👤 ')).trim();
  if (!text) continue;
  const out = await handleChat({ channel: 'test', externalId: session, text });
  console.log(`🤖 ${out.reply}${out.handoff ? '   [предадено на човек]' : ''}\n`);
}
