// GET /api/chat/history?session_id=...  -> the visible chat lines of a web session.
// Used by the widget to restore the chat (and show follow-ups/reminders) when reopened.
// The session_id is a random secret kept in the visitor's browser.
import { NextResponse } from 'next/server';
import { getSql } from '@/lib/db';
import { getSalonBySlug } from '@/lib/salon';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const url = new URL(req.url);
  const sessionId = url.searchParams.get('session_id') ?? '';
  if (!/^[\w-]{8,100}$/.test(sessionId)) return NextResponse.json({ error: 'invalid_request' }, { status: 400 });
  const salon = await getSalonBySlug(url.searchParams.get('salon') || process.env.DEFAULT_SALON_SLUG || 'demo-barber');
  if (!salon) return NextResponse.json({ error: 'salon_not_found' }, { status: 404 });
  const rows = await getSql()`
    select m.role, m.text from messages m join conversations c on c.id = m.conversation_id
    where c.salon_id = ${salon.id} and c.channel = 'web' and c.external_id = ${sessionId}
      and m.text is not null and m.text <> ''
    order by m.id`;
  return NextResponse.json({ messages: rows.map((r) => ({ from: r.role === 'user' ? 'me' : 'agent', text: r.text })) });
}
