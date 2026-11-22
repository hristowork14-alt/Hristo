// GET /api/owner/services, PUT /api/owner/services {services: [...]}
// The agent reads services from the database on every message, so saves apply immediately.
import { NextResponse } from 'next/server';
import { requireOwner } from '@/lib/auth';
import { listAllServices, saveServices, ServicesInput } from '@/lib/owner';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const auth = await requireOwner(req);
  if (auth instanceof NextResponse) return auth;
  return NextResponse.json({ services: await listAllServices(auth.salon), currency: auth.salon.currency });
}

export async function PUT(req: Request) {
  const auth = await requireOwner(req);
  if (auth instanceof NextResponse) return auth;
  const body = ServicesInput.safeParse(await req.json().catch(() => null));
  if (!body.success) {
    return NextResponse.json({ error: 'invalid_request', details: body.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`) }, { status: 400 });
  }
  return NextResponse.json({ services: await saveServices(auth.salon, body.data), currency: auth.salon.currency });
}
