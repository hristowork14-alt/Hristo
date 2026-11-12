'use client';
// Phase 1 test page: a bare chat box that talks to POST /api/chat.
// (The embeddable widget comes in Phase 2.)
import { useEffect, useRef, useState } from 'react';

type Line = { from: 'me' | 'agent'; text: string };

export default function Home() {
  const [sessionId, setSessionId] = useState('');
  const [lines, setLines] = useState<Line[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const end = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setSessionId('web-' + crypto.randomUUID());
  }, []);
  // Block body on purpose: effects must not return a value (scrollIntoView may return a Promise).
  useEffect(() => {
    end.current?.scrollIntoView({ behavior: 'smooth' });
  }, [lines]);

  async function send(e: React.FormEvent) {
    e.preventDefault();
    const message = input.trim();
    if (!message || busy) return;
    setInput('');
    setLines((l) => [...l, { from: 'me', text: message }]);
    setBusy(true);
    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ session_id: sessionId, message }),
      });
      const data = await res.json();
      setLines((l) => [...l, { from: 'agent', text: data.reply ?? 'Грешка / Error' }]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main style={{ maxWidth: 480, margin: '0 auto', padding: 16, minHeight: '100dvh', display: 'flex', flexDirection: 'column' }}>
      <h1 style={{ fontSize: 20, margin: '8px 0 16px' }}>SalonAgent — тестов чат</h1>
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 8 }}>
        {lines.length === 0 && <p style={{ color: '#77736b' }}>Напишете например „Здравейте, искам час за подстригване утре“.</p>}
        {lines.map((l, i) => (
          <div key={i} style={{
            alignSelf: l.from === 'me' ? 'flex-end' : 'flex-start', maxWidth: '85%', padding: '8px 12px', borderRadius: 14,
            background: l.from === 'me' ? '#1f4d3a' : '#fff', color: l.from === 'me' ? '#fff' : 'inherit', whiteSpace: 'pre-wrap',
          }}>{l.text}</div>
        ))}
        {busy && <div style={{ color: '#77736b' }}>…</div>}
        <div ref={end} />
      </div>
      <form onSubmit={send} style={{ display: 'flex', gap: 8, position: 'sticky', bottom: 0, padding: '12px 0', background: '#f6f5f2' }}>
        <input value={input} onChange={(e) => setInput(e.target.value)} placeholder="Съобщение…" aria-label="Съобщение"
          style={{ flex: 1, padding: '10px 12px', borderRadius: 10, border: '1px solid #ccc', fontSize: 16 }} />
        <button disabled={busy} style={{ padding: '10px 16px', borderRadius: 10, border: 0, background: '#1f4d3a', color: '#fff', fontSize: 16 }}>Изпрати</button>
      </form>
    </main>
  );
}
