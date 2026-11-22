// Owner authentication for the dashboard API.
// The browser logs in with Supabase Auth and sends its access token as
// "Authorization: Bearer <token>". We ask Supabase who that is, then find the salon
// whose owner_email matches the (verified) email address.
import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';
import { getSql } from './db';
import type { Salon } from './salon';

export interface AuthUser {
  id: string;
  email: string;
}

type Verifier = (token: string) => Promise<AuthUser | null>;

async function verifyWithSupabase(token: string): Promise<AuthUser | null> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) {
    console.error('[auth] NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY are not set');
    return null;
  }
  const supabase = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data.user?.email) return null;
  return { id: data.user.id, email: data.user.email };
}

let verifier: Verifier = verifyWithSupabase;

/** Tests replace the Supabase check with a fake. */
export function setVerifier(v: Verifier | null) {
  verifier = v ?? verifyWithSupabase;
}

/** Returns the logged-in owner and their salon, or an error response to return as-is. */
export async function requireOwner(req: Request): Promise<{ user: AuthUser; salon: Salon } | NextResponse> {
  const token = req.headers.get('authorization')?.match(/^Bearer (.+)$/)?.[1];
  const user = token ? await verifier(token) : null;
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const [salon] = await getSql()<Salon[]>`
    select * from salons where lower(owner_email) = lower(${user.email}) order by created_at limit 1`;
  if (!salon) return NextResponse.json({ error: 'no_salon_for_this_account', email: user.email }, { status: 403 });
  return { user, salon };
}
