'use client';
// "Салон" tab: salon details and opening hours. The agent uses them from the next message.
import { useEffect, useState } from 'react';
import { ownerApi } from './api';

interface Hours { weekday: number; open: string; close: string }
interface SettingsData { name: string; address: string; phone: string; extra_info: string; hours: Hours[] }
const DAYS = ['Понеделник', 'Вторник', 'Сряда', 'Четвъртък', 'Петък', 'Събота', 'Неделя'];

export default function Settings({ token, onSaved }: { token: string; onSaved: (name: string) => void }) {
  const [data, setData] = useState<SettingsData | null>(null);
  // Per weekday (1-7): open? and times. Closed days keep their last times for convenience.
  const [days, setDays] = useState<{ open: boolean; from: string; to: string }[]>([]);
  const [status, setStatus] = useState<{ kind: 'ok' | 'danger'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  function fill(d: SettingsData) {
    setData(d);
    setDays([1, 2, 3, 4, 5, 6, 7].map((w) => {
      const h = d.hours.find((x) => x.weekday === w);
      return { open: !!h, from: h?.open ?? '09:00', to: h?.close ?? '18:00' };
    }));
  }
  useEffect(() => {
    ownerApi<SettingsData>(token, 'settings').then(fill);
  }, [token]);

  const set = (patch: Partial<SettingsData>) => { setStatus(null); setData((d) => ({ ...d!, ...patch })); };
  const setDay = (i: number, patch: Partial<(typeof days)[number]>) => { setStatus(null); setDays((ds) => ds.map((d, j) => (j === i ? { ...d, ...patch } : d))); };

  async function save() {
    setBusy(true);
    try {
      const hours = days.flatMap((d, i) => (d.open ? [{ weekday: i + 1, open: d.from, close: d.to }] : []));
      const saved = await ownerApi<SettingsData>(token, 'settings', { method: 'PUT', body: { ...data, hours } });
      fill(saved);
      onSaved(saved.name);
      setStatus({ kind: 'ok', text: 'Запазено. Асистентът вече използва новото работно време.' });
    } catch {
      setStatus({ kind: 'danger', text: 'Не е запазено: проверете, че всеки отворен ден затваря след като отваря.' });
    } finally {
      setBusy(false);
    }
  }

  if (!data) return <p className="hint">Зареждане…</p>;
  return (
    <>
      <h2 className="section-title">Работно време</h2>
      <ul className="list">
        {days.map((d, i) => (
          <li key={i} className="card hours-row">
            <label className="check hours-day">
              <input type="checkbox" checked={d.open} onChange={(e) => setDay(i, { open: e.target.checked })} />
              {DAYS[i]}
            </label>
            {d.open ? (
              <div className="hours-times">
                <input className="field" type="time" step={900} value={d.from} aria-label={`${DAYS[i]} от`} onChange={(e) => setDay(i, { from: e.target.value })} />
                <span>–</span>
                <input className="field" type="time" step={900} value={d.to} aria-label={`${DAYS[i]} до`} onChange={(e) => setDay(i, { to: e.target.value })} />
              </div>
            ) : (
              <span className="hint">почивен ден</span>
            )}
          </li>
        ))}
      </ul>

      <h2 className="section-title">Данни за салона</h2>
      <div className="card form-stack">
        <div><label className="lbl" htmlFor="sname">Име</label><input id="sname" className="field" value={data.name} onChange={(e) => set({ name: e.target.value })} /></div>
        <div><label className="lbl" htmlFor="saddr">Адрес</label><input id="saddr" className="field" value={data.address} onChange={(e) => set({ address: e.target.value })} /></div>
        <div><label className="lbl" htmlFor="sphone">Телефон (асистентът го дава при нужда от човек)</label><input id="sphone" className="field" type="tel" value={data.phone} onChange={(e) => set({ phone: e.target.value })} /></div>
        <div>
          <label className="lbl" htmlFor="sinfo">Друга информация, която асистентът може да казва (паркинг, плащане…)</label>
          <textarea id="sinfo" className="field" rows={3} value={data.extra_info} onChange={(e) => set({ extra_info: e.target.value })} />
        </div>
      </div>
      {status && <p className={`notice ${status.kind}`}>{status.text}</p>}
      <div className="savebar">
        <button className="btn" onClick={save} disabled={busy}>{busy ? 'Запазване…' : 'Запази промените'}</button>
      </div>
    </>
  );
}
