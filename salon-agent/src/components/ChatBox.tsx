'use client';
// The customer chat UI, used by the full-page test chat and by the embeddable widget.
// Keeps a random session id per salon in localStorage, so a returning visitor continues
// the same conversation (and sees any follow-up or reminder sent meanwhile).
import { useEffect, useRef, useState } from 'react';

type Line = { from: 'me' | 'agent'; text: string };

function storedSessionId(salon: string): string {
  const key = `salonagent:session:${salon}`;
  try {
    const existing = localStorage.getItem(key);
    if (existing) return existing;
    const id = 'web-' + crypto.randomUUID();
    localStorage.setItem(key, id);
    return id;
  } catch {
    return 'web-' + crypto.randomUUID(); // private mode: one session per page load
  }
}

export default function ChatBox({ salon, onClose }: { salon: string; onClose?: () => void }) {
  const [sessionId, setSessionId] = useState('');
  const [salonName, setSalonName] = useState('');
  const [lines, setLines] = useState<Line[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const end = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const id = storedSessionId(salon);
    setSessionId(id);
    const q = `salon=${encodeURIComponent(salon)}`;
    fetch(`/api/salon?${q}`).then((r) => r.json()).then((d) => setSalonName(d.name ?? '')).catch(() => {});
    fetch(`/api/chat/history?${q}&session_id=${id}`)
      .then((r) => r.json())
      .then((d) => Array.isArray(d.messages) && setLines(d.messages))
      .catch(() => {});
  }, [salon]);

  // Block body on purpose: effects must not return a value (scrollIntoView may return a Promise).
  useEffect(() => {
    end.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [lines, busy]);

  async function send(e: React.FormEvent) {
    e.preventDefault();
    const message = input.trim();
    if (!message || busy || !sessionId) return;
    setInput('');
    setLines((l) => [...l, { from: 'me', text: message }]);
    setBusy(true);
    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ session_id: sessionId, message, salon }),
      });
      const data = await res.json();
      setLines((l) => [...l, { from: 'agent', text: data.reply ?? 'Възникна грешка. Моля, опитайте отново.' }]);
    } catch {
      setLines((l) => [...l, { from: 'agent', text: 'Няма връзка. Моля, опитайте отново.' }]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="chat">
      <div className="chat-head">
        <div className="title">
          {salonName || 'Онлайн рецепция'}
          <div className="sub">Онлайн рецепция · отговаря веднага</div>
        </div>
        {onClose && <button onClick={onClose} aria-label="Затвори">×</button>}
      </div>
      <div className="chat-log" aria-live="polite">
        {lines.length === 0 && (
          <div className="bubble agent">Здравейте! Мога да ви кажа цени и свободни часове и да ви запиша. С какво да помогна?</div>
        )}
        {lines.map((l, i) => (
          <div key={i} className={`bubble ${l.from}`}>{l.text}</div>
        ))}
        {busy && <div className="typing">пише…</div>}
        <div ref={end} />
      </div>
      <form className="chat-form" onSubmit={send}>
        <input className="field" value={input} onChange={(e) => setInput(e.target.value)}
          placeholder="Напишете съобщение…" aria-label="Съобщение" maxLength={2000} />
        <button className="btn" disabled={busy || !input.trim()}>Изпрати</button>
      </form>
    </div>
  );
}
