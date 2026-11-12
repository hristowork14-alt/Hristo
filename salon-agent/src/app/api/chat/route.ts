// POST /api/chat  { session_id, message }  ->  { reply, conversation_id, handoff }
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { handleChat } from '@/lib/agent';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Body = z.object({
  session_id: z.string().trim().min(8).max(100).regex(/^[\w-]+$/, 'letters, digits, _ and - only'),
  message: z.string().trim().min(1).max(2000),
  salon: z.string().max(60).optional(), // salon slug; defaults to DEFAULT_SALON_SLUG
});

export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid_request', details: parsed.error.issues.map((i) => i.message) }, { status: 400 });
  }
  const { session_id, message, salon } = parsed.data;
  try {
    const out = await handleChat({ salonSlug: salon, channel: 'web', externalId: session_id, text: message });
    return NextResponse.json({ reply: out.reply, conversation_id: out.conversationId, handoff: out.handoff });
  } catch (e) {
    if (e instanceof Error && e.message === 'salon_not_found') {
      return NextResponse.json({ error: 'salon_not_found' }, { status: 404 });
    }
    console.error('[api/chat]', e);
    return NextResponse.json({ error: 'internal_error' }, { status: 500 });
  }
}
