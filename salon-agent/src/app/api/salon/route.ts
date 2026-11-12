// GET /api/salon?salon=slug -> public salon name (for the widget header).
import { NextResponse } from 'next/server';
import { getSalonBySlug } from '@/lib/salon';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const slug = new URL(req.url).searchParams.get('salon') || process.env.DEFAULT_SALON_SLUG || 'demo-barber';
  const salon = await getSalonBySlug(slug);
  if (!salon) return NextResponse.json({ error: 'salon_not_found' }, { status: 404 });
  return NextResponse.json({ name: salon.name, phone: salon.phone, address: salon.address });
}
