// GET /api/owner/settings, PUT /api/owner/settings {name, address, phone, extra_info, hours: [...]}
// Hours = the open days only; a day that is left out is closed.
import { NextResponse } from 'next/server';
import { requireOwner } from '@/lib/auth';
import { getSalonById } from '@/lib/salon';
import { getSettings, saveSettings, SettingsInput } from '@/lib/owner';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const auth = await requireOwner(req);
  if (auth instanceof NextResponse) return auth;
  return NextResponse.json(await getSettings(auth.salon));
}

export async function PUT(req: Request) {
  const auth = await requireOwner(req);
  if (auth instanceof NextResponse) return auth;
  const body = SettingsInput.safeParse(await req.json().catch(() => null));
  if (!body.success) {
    return NextResponse.json({ error: 'invalid_request', details: body.error.issues.map((i) => i.message) }, { status: 400 });
  }
  await saveSettings(auth.salon, body.data);
  return NextResponse.json(await getSettings((await getSalonById(auth.salon.id))!));
}
