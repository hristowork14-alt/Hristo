// GET /api/cron — runs the follow-up and reminder jobs. Call it every 15 minutes
// (Vercel Cron, Supabase pg_cron, or any external scheduler) with
//   Authorization: Bearer <CRON_SECRET>
import { NextResponse } from 'next/server';
import { getSql } from '@/lib/db';
import { sendFollowups, sendReminders } from '@/lib/jobs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const sql = getSql();
  const followups = await sendFollowups(sql);
  const reminders = await sendReminders(sql);
  return NextResponse.json({ followups, reminders });
}
