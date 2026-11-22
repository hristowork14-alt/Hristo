'use client';
// Calls the owner API with the logged-in user's token.
export async function ownerApi<T = unknown>(token: string, path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const res = await fetch(`/api/owner/${path}`, {
    method: init.method ?? 'GET',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error ?? `HTTP ${res.status}`), { status: res.status, data });
  return data as T;
}

export const money = (n: number, currency: string) =>
  new Intl.NumberFormat('bg-BG', { style: 'currency', currency, maximumFractionDigits: n % 1 ? 2 : 0 }).format(n);

export const shortDateTime = (iso: string) =>
  new Intl.DateTimeFormat('bg-BG', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Sofia' }).format(new Date(iso));

/** +359888123456 -> +359 888 123 456 (other numbers unchanged). */
export const prettyPhone = (p: string) => p.replace(/^\+359(\d{3})(\d{3})(\d{3,4})$/, '+359 $1 $2 $3');
