'use client';
// Owner dashboard shell: checks the login, then shows four tabs.
// Mobile-first: the tab bar sits at the bottom on phones and at the top on wider screens.
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import Conversations from '@/components/dashboard/Conversations';
import Services from '@/components/dashboard/Services';
import Settings from '@/components/dashboard/Settings';
import Today from '@/components/dashboard/Today';
import { ownerApi } from '@/components/dashboard/api';
import { supabaseBrowser } from '@/lib/supabase-browser';

const TABS = [
  { id: 'today', label: 'Часове', icon: 'M8 2v4M16 2v4M3 10h18M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z' },
  { id: 'chats', label: 'Разговори', icon: 'M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z' },
  { id: 'services', label: 'Услуги', icon: 'M4 6h16M4 12h16M4 18h10' },
  { id: 'settings', label: 'Салон', icon: 'M12 7v5l3 2M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z' },
] as const;
type TabId = (typeof TABS)[number]['id'];

export default function Dashboard() {
  const router = useRouter();
  const [token, setToken] = useState<string | null>(null);
  const [salonName, setSalonName] = useState('');
  const [problem, setProblem] = useState('');
  const [tab, setTab] = useState<TabId>('today');

  useEffect(() => {
    const supabase = supabaseBrowser();
    if (!supabase) return router.replace('/login');
    supabase.auth.getSession().then(({ data }) => {
      if (!data.session) router.replace('/login');
      else setToken(data.session.access_token);
    });
    // Keep the token fresh (Supabase refreshes it in the background).
    const { data } = supabase.auth.onAuthStateChange((_e, session) => {
      if (session) setToken(session.access_token);
      else router.replace('/login');
    });
    return () => data.subscription.unsubscribe();
  }, [router]);

  useEffect(() => {
    if (!token) return;
    ownerApi<{ salon: { name: string } }>(token, 'overview')
      .then((d) => setSalonName(d.salon.name))
      .catch((e) => setProblem(e.status === 403 ? 'Този акаунт не е свързан със салон. Поискайте достъп от администратора.' : 'Не успяхме да заредим таблото.'));
  }, [token]);

  async function logout() {
    await supabaseBrowser()?.auth.signOut();
    router.replace('/login');
  }

  if (!token) return <main className="auth-wrap"><p className="hint">Зареждане…</p></main>;

  return (
    <div className="dash">
      <header className="topbar">
        <div className="topbar-title">{salonName || 'SalonAgent'}</div>
        <button className="btn secondary small" onClick={logout}>Изход</button>
      </header>
      <nav className="tabbar" aria-label="Раздели">
        {TABS.map((t) => (
          <button key={t.id} className={tab === t.id ? 'active' : ''} onClick={() => setTab(t.id)} aria-current={tab === t.id ? 'page' : undefined}>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={t.icon} /></svg>
            <span>{t.label}</span>
          </button>
        ))}
      </nav>
      <main className="dash-main">
        {problem ? <p className="notice danger">{problem}</p> : (
          <>
            {tab === 'today' && <Today token={token} />}
            {tab === 'chats' && <Conversations token={token} />}
            {tab === 'services' && <Services token={token} />}
            {tab === 'settings' && <Settings token={token} onSaved={setSalonName} />}
          </>
        )}
      </main>
    </div>
  );
}
