// GET /api/owner/overview?date=YYYY-MM-DD -> that day's bookings + this week's numbers
import { NextResponse } from 'next/server';
import { requireOwner } from '@/lib/auth';
import { overview } from '@/lib/owner';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const auth = await requireOwner(req);
  if (auth instanceof NextResponse) return auth;
  const date = new URL(req.url).searchParams.get('date');
  if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) return NextResponse.json({ error: 'invalid_date' }, { status: 400 });
  return NextResponse.json(await overview(auth.salon, date));
}
