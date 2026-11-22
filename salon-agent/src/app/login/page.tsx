'use client';
// Owner login (Supabase Auth, email + password).
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { supabaseBrowser } from '@/lib/supabase-browser';

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const supabase = supabaseBrowser();

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!supabase) return;
    setBusy(true);
    setError('');
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    setBusy(false);
    if (error) setError('Грешен имейл или парола.');
    else router.replace('/dashboard');
  }

  return (
    <main className="auth-wrap">
      <form className="auth-card" onSubmit={submit}>
        <h1>Вход за собственици</h1>
        <p className="hint">SalonAgent — табло на салона</p>
        {!supabase && <p className="notice warn">Supabase не е настроен (NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY).</p>}
        <label className="lbl" htmlFor="email">Имейл</label>
        <input id="email" className="field" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        <label className="lbl" htmlFor="password" style={{ marginTop: 12 }}>Парола</label>
        <input id="password" className="field" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
        {error && <p className="notice danger">{error}</p>}
        <button className="btn" style={{ width: '100%', marginTop: 16 }} disabled={busy || !supabase}>{busy ? 'Влизане…' : 'Вход'}</button>
      </form>
    </main>
  );
}
