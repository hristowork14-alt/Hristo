// POST /api/owner/bookings {id, action: "cancel"}
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireOwner } from '@/lib/auth';
import { cancelBooking } from '@/lib/owner';

export const runtime = 'nodejs';
const Body = z.object({ id: z.string().uuid(), action: z.literal('cancel') });

export async function POST(req: Request) {
  const auth = await requireOwner(req);
  if (auth instanceof NextResponse) return auth;
  const body = Body.safeParse(await req.json().catch(() => null));
  if (!body.success) return NextResponse.json({ error: 'invalid_request' }, { status: 400 });
  const ok = await cancelBooking(auth.salon, body.data.id);
  return ok ? NextResponse.json({ ok }) : NextResponse.json({ error: 'not_found' }, { status: 404 });
}
