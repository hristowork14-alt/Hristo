'use client';
// "Часове" tab: headline numbers for the week and the bookings of a chosen day.
import { useCallback, useEffect, useState } from 'react';
import { money, ownerApi, prettyPhone } from './api';

interface Booking {
  id: string; code: string; customer_name: string; customer_phone: string; time: string; end_time: string;
  price: number; status: string; source: string; service: string; barber: string;
}
interface Overview {
  salon: { name: string; currency: string };
  date: string; today: string; week: { from: string; to: string };
  stats: { today_count: number; week_agent_count: number; week_agent_value: number; week_revenue: number; open_handoffs: number };
  bookings: Booking[];
}

function shift(date: string, days: number) {
  const d = new Date(date + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
const dayLabel = (date: string) =>
  new Intl.DateTimeFormat('bg-BG', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' }).format(new Date(date + 'T12:00:00Z'));

export default function Today({ token }: { token: string }) {
  const [date, setDate] = useState<string | null>(null);
  const [data, setData] = useState<Overview | null>(null);
  const [error, setError] = useState('');

  const load = useCallback(() => {
    ownerApi<Overview>(token, `overview${date ? `?date=${date}` : ''}`).then(setData).catch(() => setError('Грешка при зареждане.'));
  }, [token, date]);
  useEffect(load, [load]);

  async function cancel(b: Booking) {
    if (!confirm(`Да отменя ли часа на ${b.customer_name} в ${b.time}?`)) return;
    await ownerApi(token, 'bookings', { method: 'POST', body: { id: b.id, action: 'cancel' } });
    load();
  }

  if (error) return <p className="notice danger">{error}</p>;
  if (!data) return <p className="hint">Зареждане…</p>;
  const cur = data.salon.currency;
  const active = data.bookings.filter((b) => b.status === 'confirmed');

  return (
    <>
      <section className="stats" aria-label="Обобщение">
        <div className="stat"><div className="stat-num">{data.stats.today_count}</div><div className="stat-lbl">часа днес</div></div>
        <div className="stat"><div className="stat-num">{data.stats.week_agent_count}</div><div className="stat-lbl">записани от AI тази седмица</div></div>
        <div className="stat"><div className="stat-num">{money(data.stats.week_revenue, cur)}</div><div className="stat-lbl">очакван оборот тази седмица</div></div>
        <div className="stat"><div className="stat-num">{money(data.stats.week_agent_value, cur)}</div><div className="stat-lbl">от тях чрез AI</div></div>
      </section>
      {data.stats.open_handoffs > 0 && (
        <p className="notice warn">{data.stats.open_handoffs === 1 ? '1 разговор чака' : `${data.stats.open_handoffs} разговора чакат`} отговор от човек — вижте „Разговори“.</p>
      )}

      <div className="daynav">
        <button className="btn secondary small" onClick={() => setDate(shift(data.date, -1))} aria-label="Предишен ден">‹</button>
        <div className="daynav-label">
          <strong>{data.date === data.today ? 'Днес' : dayLabel(data.date)}</strong>
          {data.date === data.today && <span className="hint"> · {dayLabel(data.date)}</span>}
        </div>
        <button className="btn secondary small" onClick={() => setDate(shift(data.date, 1))} aria-label="Следващ ден">›</button>
      </div>
      {data.date !== data.today && <button className="linkbtn" onClick={() => setDate(null)}>← към днес</button>}

      {data.bookings.length === 0 ? (
        <p className="empty">Няма записани часове за този ден.</p>
      ) : (
        <ul className="list">
          {data.bookings.map((b) => (
            <li key={b.id} className={`card booking ${b.status}`}>
              <div className="booking-time">{b.time}<span>{b.end_time}</span></div>
              <div className="booking-body">
                <div className="booking-who">
                  {b.customer_name}
                  {b.source === 'agent' && <span className="badge brand">AI</span>}
                  {b.status === 'cancelled' && <span className="badge">отменен</span>}
                </div>
                <div className="hint">{b.service} · {b.barber} · {money(b.price, cur)}</div>
                <a href={`tel:${b.customer_phone}`} className="phone">{prettyPhone(b.customer_phone)}</a>
              </div>
              {b.status === 'confirmed' && (
                <button className="btn danger small" onClick={() => cancel(b)} aria-label={`Отмени часа на ${b.customer_name}`}>Отмени</button>
              )}
            </li>
          ))}
        </ul>
      )}
      {active.length > 0 && <p className="hint" style={{ textAlign: 'right' }}>Общо за деня: {money(active.reduce((s, b) => s + b.price, 0), cur)}</p>}
    </>
  );
}
