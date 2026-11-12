// Shared test helpers: a clean seeded database, a fixed clock and a scripted fake model.
import type Anthropic from '@anthropic-ai/sdk';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ModelCall } from '../src/lib/agent';
import { getSql } from '../src/lib/db';
import { getSalonById, listServices, listStaff } from '../src/lib/salon';
import { seedDemo } from '../src/lib/seed';
import { fromLocal } from '../src/lib/time';

export const TZ = 'Europe/Sofia';
/** Monday 16 Nov 2026, 08:00 in Sofia. Tomorrow = Tuesday 17th, Sunday = 22nd. */
export const NOW = fromLocal('2026-11-16', '08:00', TZ);

/** Drops everything, applies the migrations and seeds the demo salon. */
export async function resetDb() {
  const sql = getSql();
  await sql.unsafe('drop schema public cascade; create schema public;');
  const dir = join(process.cwd(), 'supabase/migrations');
  for (const f of readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()) {
    await sql.unsafe(readFileSync(join(dir, f), 'utf8'));
  }
  const salonId = await seedDemo(sql);
  const salon = (await getSalonById(salonId))!;
  const services = await listServices(salonId);
  const staff = await listStaff(salonId);
  const svc = (nameBg: string) => services.find((s) => s.name_bg === nameBg)!;
  return { sql, salon, services, staff, svc };
}

/** Inserts a booking directly (as if made earlier), in salon local time. */
export async function insertBooking(o: {
  salonId: string; staffId: string; serviceId: string; date: string; time: string; minutes: number;
  name?: string; phone?: string; code?: string; price?: number;
}) {
  const start = fromLocal(o.date, o.time, TZ);
  const end = new Date(start.getTime() + o.minutes * 60_000);
  const [row] = await getSql()`
    insert into bookings (code, salon_id, staff_id, service_id, customer_name, customer_phone, starts_at, ends_at, price)
    values (${o.code ?? 'T' + Math.random().toString(36).slice(2, 7).toUpperCase()}, ${o.salonId}, ${o.staffId},
            ${o.serviceId}, ${o.name ?? 'Тест'}, ${o.phone ?? '+359888000000'}, ${start}, ${end}, ${o.price ?? 15})
    returning *`;
  return row;
}

// ── Scripted fake model ────────────────────────────────────────────────────────
// Each step returns what "Claude" says next: either tool calls or a final text.
// Steps can look at the request (e.g. the last tool result) to decide.

type Step =
  | { tools: { name: string; input: Record<string, unknown> }[] }
  | { text: string }
  | { refusal: true }
  | { throws: Error };

export function scriptedModel(steps: (Step | ((req: Anthropic.Beta.MessageCreateParamsNonStreaming) => Step))[]) {
  const requests: Anthropic.Beta.MessageCreateParamsNonStreaming[] = [];
  let i = 0;
  const model: ModelCall = async (req) => {
    requests.push(structuredClone(req));
    const raw = steps[i++];
    if (!raw) throw new Error(`scripted model ran out of steps (call ${i})`);
    const step = typeof raw === 'function' ? raw(req) : raw;
    if ('throws' in step) throw step.throws;
    const base = { id: `msg_${i}`, type: 'message', role: 'assistant', model: 'fake', stop_sequence: null, stop_details: null,
      usage: { input_tokens: 0, output_tokens: 0 } } as unknown as Anthropic.Beta.BetaMessage;
    if ('refusal' in step) return { ...base, content: [], stop_reason: 'refusal' } as Anthropic.Beta.BetaMessage;
    if ('text' in step) return { ...base, content: [{ type: 'text', text: step.text, citations: null }], stop_reason: 'end_turn' } as Anthropic.Beta.BetaMessage;
    return {
      ...base,
      stop_reason: 'tool_use',
      content: step.tools.map((t, n) => ({ type: 'tool_use', id: `tu_${i}_${n}`, name: t.name, input: t.input })),
    } as Anthropic.Beta.BetaMessage;
  };
  return { model, requests, remaining: () => steps.length - i };
}

/** The parsed JSON of the most recent tool_result blocks in a request. */
export function lastToolResults(req: Anthropic.Beta.MessageCreateParamsNonStreaming) {
  const blocks = req.messages[req.messages.length - 1].content;
  if (!Array.isArray(blocks)) return [];
  return (blocks as Anthropic.Beta.BetaToolResultBlockParam[])
    .filter((b) => b.type === 'tool_result')
    .map((b) => ({ isError: !!b.is_error, data: JSON.parse(b.content as string) }));
}
