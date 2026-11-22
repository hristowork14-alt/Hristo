// The agent loop: load the conversation, ask Claude, run any tools it calls, repeat,
// and store everything. Every channel (web chat, Telegram, tests) goes through handleChat().
import Anthropic from '@anthropic-ai/sdk';
import { getSql } from './db';
import { buildSystemPrompt } from './prompt';
import { getSalonById, getSalonBySlug, listHours, type Salon } from './salon';
import { runTool, TOOL_DEFINITIONS } from './tools';

type BetaMessage = Anthropic.Beta.BetaMessage;
type BetaMessageParam = Anthropic.Beta.BetaMessageParam;
type CreateParams = Anthropic.Beta.MessageCreateParamsNonStreaming;

/** Calls the model. Tests pass a fake one; production uses callClaude(). */
export type ModelCall = (params: CreateParams) => Promise<BetaMessage>;

export interface ChatInput {
  salonSlug?: string;
  salonId?: string;
  channel: 'web' | 'telegram' | 'test';
  externalId: string; // session_id for web, chat id for Telegram
  text: string;
  now?: Date; // injectable clock for tests
  model?: ModelCall;
}

export interface ChatOutput {
  reply: string;
  conversationId: string;
  handoff: boolean;
}

const MAX_TOOL_ROUNDS = 8; // safety stop for runaway tool loops
const MAX_USER_MESSAGES_PER_HOUR = 30; // cost guard per conversation

export async function handleChat(input: ChatInput): Promise<ChatOutput> {
  const sql = getSql();
  const now = input.now ?? new Date();
  const salon = input.salonId ? await getSalonById(input.salonId) : await getSalonBySlug(input.salonSlug ?? defaultSlug());
  if (!salon) throw new Error('salon_not_found');

  // Find or create the conversation for this session.
  const [conv] = await sql`
    insert into conversations (salon_id, channel, external_id, last_message_at)
    values (${salon.id}, ${input.channel}, ${input.externalId}, ${now})
    on conflict (salon_id, channel, external_id) do update set last_message_at = excluded.last_message_at
    returning id, handoff`;
  const conversationId: string = conv.id;

  const [{ count }] = await sql`
    select count(*)::int as count from messages
    where conversation_id = ${conversationId} and role = 'user' and text is not null
      and created_at > ${new Date(now.getTime() - 3600_000)}`;
  if (count >= MAX_USER_MESSAGES_PER_HOUR) {
    return { reply: fallbackReply(salon, 'rate'), conversationId, handoff: conv.handoff };
  }

  // Full history, exactly as the API produced it (append-only).
  const history = await sql`
    select role, content from messages where conversation_id = ${conversationId} order by id`;
  const messages = history.map((m) => ({ role: m.role, content: m.content })) as BetaMessageParam[];

  const userMsg: BetaMessageParam = { role: 'user', content: [{ type: 'text', text: input.text }] };
  messages.push(userMsg);
  await saveMessage(conversationId, userMsg, input.text);

  const system = buildSystemPrompt(salon, await listHours(salon.id), now);
  const callModel = input.model ?? defaultModel;
  let reply = '';

  try {
    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
      const response = await callModel(requestParams(system, messages));
      const assistantMsg: BetaMessageParam = { role: 'assistant', content: response.content };

      if (response.stop_reason === 'refusal') {
        // Safety classifier declined. Don't replay the refused turn; hand off to a person.
        console.warn(JSON.stringify({ at: 'agent', conversation: conversationId, refusal: response.stop_details }));
        await runTool('handoff_to_human', { reason: 'Model declined to answer (refusal)' }, { sql, salon, conversationId, now });
        reply = fallbackReply(salon, 'handoff');
        break;
      }

      messages.push(assistantMsg);
      const text = textOf(response);

      if (response.stop_reason !== 'tool_use') {
        await saveMessage(conversationId, assistantMsg, text);
        reply = text;
        break;
      }

      // Run each requested tool (one by one, so bookings never race each other) and
      // send all results back in a single user message.
      const results: Anthropic.Beta.BetaToolResultBlockParam[] = [];
      for (const block of response.content) {
        if (block.type !== 'tool_use') continue;
        const result = await runTool(block.name, block.input, { sql, salon, conversationId, now });
        results.push({ type: 'tool_result', tool_use_id: block.id, content: JSON.stringify(result.data), is_error: !result.ok });
      }
      const toolMsg: BetaMessageParam = { role: 'user', content: results };
      messages.push(toolMsg);
      // Save the tool call and its results together, so the stored history is always valid.
      await saveMessage(conversationId, assistantMsg, text || null);
      await saveMessage(conversationId, toolMsg, null);
    }
  } catch (e) {
    console.error(JSON.stringify({ at: 'agent', conversation: conversationId, error: String(e) }));
    reply = fallbackReply(salon, 'error');
  }

  if (!reply) reply = fallbackReply(salon, 'error');
  const [after] = await sql`select handoff from conversations where id = ${conversationId}`;
  return { reply, conversationId, handoff: after.handoff };
}

// ── Claude request ─────────────────────────────────────────────────────────────

export const MODEL = () => process.env.ANTHROPIC_MODEL || 'claude-sonnet-5-5';

function requestParams(system: string, messages: BetaMessageParam[]): CreateParams {
  return {
    model: MODEL(),
    max_tokens: 4096,
    // Low effort: quick, short chat replies. Thinking stays adaptive (the model skips it on
    // simple messages). If the system prompt changed since an earlier turn (new day, owner
    // edited hours), stale thinking blocks are dropped instead of failing the request.
    output_config: { effort: 'low' },
    thinking: { type: 'adaptive', block_binding: { prefix_mismatch_behavior: 'drop_block' } },
    // If Claude Sonnet 5.5 declines, the API retries on a fallback model automatically.
    betas: ['server-side-fallback-2026-07-01', 'thinking-binding-controls-2026-08-01'],
    fallbacks: 'default',
    // Cache the system prompt + tools + history between turns (cheaper, faster).
    cache_control: { type: 'ephemeral' },
    system,
    tools: TOOL_DEFINITIONS,
    messages,
  };
}

let client: Anthropic | null = null;

// Routes (web, Telegram) use this. Tests swap in a scripted model with setDefaultModel().
let defaultModel: ModelCall = (params) => callClaude(params);
export function setDefaultModel(model: ModelCall | null) {
  defaultModel = model ?? ((params) => callClaude(params));
}

export const callClaude: ModelCall = async (params) => {
  client ??= new Anthropic(); // reads ANTHROPIC_API_KEY
  try {
    return await client.beta.messages.create(params);
  } catch (e) {
    // Safety net: if the account rejects one of the beta features above, retry once with a
    // plain request (thinking blocks removed from history so nothing can mismatch).
    if (e instanceof Anthropic.BadRequestError) {
      console.warn(JSON.stringify({ at: 'agent', retryPlain: e.message }));
      return client.beta.messages.create({
        model: params.model,
        max_tokens: params.max_tokens,
        output_config: { effort: 'low' },
        system: params.system,
        tools: params.tools,
        messages: stripThinking(params.messages),
      });
    }
    throw e;
  }
};

function stripThinking(messages: BetaMessageParam[]): BetaMessageParam[] {
  return messages.map((m) =>
    typeof m.content === 'string' || m.role !== 'assistant'
      ? m
      : { ...m, content: m.content.filter((b) => b.type !== 'thinking' && b.type !== 'redacted_thinking') },
  );
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function textOf(message: BetaMessage): string {
  return message.content
    .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('\n')
    .trim();
}

async function saveMessage(conversationId: string, msg: BetaMessageParam, text: string | null) {
  const sql = getSql();
  await sql`insert into messages (conversation_id, role, content, text)
            values (${conversationId}, ${msg.role}, ${sql.json(msg.content as never)}, ${text})`;
}

function defaultSlug() {
  return process.env.DEFAULT_SALON_SLUG || 'demo-barber';
}

function fallbackReply(salon: Salon, kind: 'error' | 'handoff' | 'rate'): string {
  const phone = salon.phone ? ` ${salon.phone}` : '';
  if (kind === 'rate') return `Получихме много съобщения. Моля, обадете се на${phone}. / Too many messages, please call us${phone}.`;
  if (kind === 'handoff') return `Ще предам въпроса ви на колега, който ще се свърже с вас. Можете да се обадите и на${phone}.`;
  return `Извинете, в момента имам технически проблем. Моля, опитайте пак или се обадете на${phone}.`;
}
