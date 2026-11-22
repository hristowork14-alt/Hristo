'use client';
// "Разговори" tab: every chat (web + Telegram); open one to read it, including the
// agent's tool calls (useful to see why it answered what it answered).
import { useCallback, useEffect, useState } from 'react';
import { ownerApi, prettyPhone, shortDateTime } from './api';

interface Conv {
  id: string; channel: string; customer_name: string | null; customer_phone: string | null; handoff: boolean;
  handoff_reason: string | null; last_message_at: string; last_text: string | null; user_messages: number; booked: boolean;
}
type Item =
  | { kind: 'message'; id: number; role: 'user' | 'assistant'; text: string; created_at: string }
  | { kind: 'tool'; id: number; tool: string; input: unknown; output: unknown; is_error: boolean; duration_ms: number; created_at: string };

const CHANNEL: Record<string, string> = { web: 'Сайт', telegram: 'Telegram', test: 'Тест' };

export default function Conversations({ token }: { token: string }) {
  const [list, setList] = useState<Conv[] | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);

  const load = useCallback(() => {
    ownerApi<{ conversations: Conv[] }>(token, 'conversations').then((d) => setList(d.conversations));
  }, [token]);
  useEffect(load, [load]);

  if (openId) return <Detail token={token} id={openId} onBack={() => { setOpenId(null); load(); }} />;
  if (!list) return <p className="hint">Зареждане…</p>;
  if (list.length === 0) return <p className="empty">Още няма разговори. Когато клиент пише в чата или в Telegram, ще го видите тук.</p>;

  return (
    <ul className="list">
      {list.map((c) => (
        <li key={c.id}>
          <button className={`card conv ${c.handoff ? 'needs-human' : ''}`} onClick={() => setOpenId(c.id)}>
            <div className="conv-top">
              <strong>{c.customer_name || 'Без име'}</strong>
              <span className="hint">{shortDateTime(c.last_message_at)}</span>
            </div>
            <div className="conv-text">{c.last_text ?? '—'}</div>
            <div className="conv-badges">
              <span className="badge">{CHANNEL[c.channel] ?? c.channel}</span>
              {c.booked && <span className="badge brand">записан час</span>}
              {c.handoff && <span className="badge warn">чака човек</span>}
            </div>
          </button>
        </li>
      ))}
    </ul>
  );
}

function Detail({ token, id, onBack }: { token: string; id: string; onBack: () => void }) {
  const [data, setData] = useState<{ conversation: Conv; timeline: Item[] } | null>(null);
  const load = useCallback(() => {
    ownerApi<{ conversation: Conv; timeline: Item[] }>(token, `conversations?id=${id}`).then(setData);
  }, [token, id]);
  useEffect(load, [load]);

  async function resolve() {
    await ownerApi(token, 'conversations', { method: 'POST', body: { id, action: 'resolve' } });
    load();
  }

  if (!data) return <p className="hint">Зареждане…</p>;
  const c = data.conversation;
  return (
    <>
      <button className="linkbtn" onClick={onBack}>← Всички разговори</button>
      <div className="card" style={{ margin: '8px 0 12px' }}>
        <strong>{c.customer_name || 'Без име'}</strong>
        {c.customer_phone && <> · <a href={`tel:${c.customer_phone}`}>{prettyPhone(c.customer_phone)}</a></>}
        <div className="hint">{CHANNEL[c.channel] ?? c.channel}</div>
      </div>
      {c.handoff && (
        <div className="notice warn" style={{ display: 'flex', gap: 12, alignItems: 'center', justifyContent: 'space-between' }}>
          <span>Чака човек: {c.handoff_reason}</span>
          <button className="btn small" onClick={resolve}>Готово</button>
        </div>
      )}
      <div className="transcript">
        {data.timeline.map((t) =>
          t.kind === 'message' ? (
            <div key={`m${t.id}`} className={`bubble ${t.role === 'user' ? 'agent' : 'me'}`} title={shortDateTime(t.created_at)}>{t.text}</div>
          ) : (
            <details key={`t${t.id}`} className={`toolrow ${t.is_error ? 'err' : ''}`}>
              <summary>⚙ {t.tool}{t.is_error ? ' — отказ' : ''} <span className="hint">({t.duration_ms} ms)</span></summary>
              <pre>{JSON.stringify({ input: t.input, output: t.output }, null, 2)}</pre>
            </details>
          ),
        )}
      </div>
    </>
  );
}
