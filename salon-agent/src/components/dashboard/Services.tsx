'use client';
// "Услуги" tab: edit names, durations and prices. The agent uses them from the next message.
import { useEffect, useState } from 'react';
import { ownerApi } from './api';

interface Service { id?: string; name_bg: string; name_en: string; duration_min: number; price: number; active: boolean }

export default function Services({ token }: { token: string }) {
  const [rows, setRows] = useState<Service[] | null>(null);
  const [currency, setCurrency] = useState('EUR');
  const [status, setStatus] = useState<{ kind: 'ok' | 'danger'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    ownerApi<{ services: Service[]; currency: string }>(token, 'services').then((d) => {
      setRows(d.services);
      setCurrency(d.currency);
    });
  }, [token]);

  const update = (i: number, patch: Partial<Service>) => {
    setStatus(null);
    setRows((r) => r!.map((s, j) => (j === i ? { ...s, ...patch } : s)));
  };

  async function save() {
    setBusy(true);
    try {
      const d = await ownerApi<{ services: Service[] }>(token, 'services', { method: 'PUT', body: { services: rows } });
      setRows(d.services);
      setStatus({ kind: 'ok', text: 'Запазено. Асистентът вече използва новите цени.' });
    } catch {
      setStatus({ kind: 'danger', text: 'Не е запазено: проверете, че всяка услуга има име, продължителност 5–480 мин. и цена.' });
    } finally {
      setBusy(false);
    }
  }

  if (!rows) return <p className="hint">Зареждане…</p>;
  return (
    <>
      <ul className="list">
        {rows.map((s, i) => (
          <li key={s.id ?? `new-${i}`} className={`card svc ${s.active ? '' : 'inactive'}`}>
            <div className="svc-grid">
              <div className="span2">
                <label className="lbl" htmlFor={`bg${i}`}>Име</label>
                <input id={`bg${i}`} className="field" value={s.name_bg} onChange={(e) => update(i, { name_bg: e.target.value })} />
              </div>
              <div className="span2">
                <label className="lbl" htmlFor={`en${i}`}>Name (English)</label>
                <input id={`en${i}`} className="field" value={s.name_en} onChange={(e) => update(i, { name_en: e.target.value })} />
              </div>
              <div>
                <label className="lbl" htmlFor={`d${i}`}>Минути</label>
                <input id={`d${i}`} className="field" type="number" inputMode="numeric" min={5} max={480} step={5}
                  value={s.duration_min} onChange={(e) => update(i, { duration_min: Number(e.target.value) })} />
              </div>
              <div>
                <label className="lbl" htmlFor={`p${i}`}>Цена ({currency})</label>
                <input id={`p${i}`} className="field" type="number" inputMode="decimal" min={0} step={0.5}
                  value={s.price} onChange={(e) => update(i, { price: Number(e.target.value) })} />
              </div>
            </div>
            <label className="check">
              <input type="checkbox" checked={s.active} onChange={(e) => update(i, { active: e.target.checked })} />
              Предлага се {s.active ? '' : '(скрита за клиентите)'}
            </label>
          </li>
        ))}
      </ul>
      <button className="btn secondary" style={{ width: '100%', marginTop: 12 }}
        onClick={() => setRows((r) => [...r!, { name_bg: '', name_en: '', duration_min: 30, price: 0, active: true }])}>
        + Добави услуга
      </button>
      {status && <p className={`notice ${status.kind}`}>{status.text}</p>}
      <div className="savebar">
        <button className="btn" onClick={save} disabled={busy}>{busy ? 'Запазване…' : 'Запази промените'}</button>
      </div>
    </>
  );
}
