// GET  /api/owner/conversations          -> list
// GET  /api/owner/conversations?id=...   -> one conversation with messages and tool calls
// POST /api/owner/conversations {id, action: "resolve"} -> clear the "needs a human" flag
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireOwner } from '@/lib/auth';
import { getConversation, listConversations, resolveHandoff } from '@/lib/owner';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const auth = await requireOwner(req);
  if (auth instanceof NextResponse) return auth;
  const id = new URL(req.url).searchParams.get('id');
  if (!id) return NextResponse.json({ conversations: await listConversations(auth.salon) });
  if (!z.string().uuid().safeParse(id).success) return NextResponse.json({ error: 'invalid_id' }, { status: 400 });
  const conv = await getConversation(auth.salon, id);
  return conv ? NextResponse.json(conv) : NextResponse.json({ error: 'not_found' }, { status: 404 });
}

const Body = z.object({ id: z.string().uuid(), action: z.literal('resolve') });

export async function POST(req: Request) {
  const auth = await requireOwner(req);
  if (auth instanceof NextResponse) return auth;
  const body = Body.safeParse(await req.json().catch(() => null));
  if (!body.success) return NextResponse.json({ error: 'invalid_request' }, { status: 400 });
  const ok = await resolveHandoff(auth.salon, body.data.id);
  return ok ? NextResponse.json({ ok }) : NextResponse.json({ error: 'not_found' }, { status: 404 });
}
