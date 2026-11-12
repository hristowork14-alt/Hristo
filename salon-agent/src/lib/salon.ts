// Reads salon configuration from the database. Nothing is cached, so edits made in the
// owner dashboard (Phase 3) reach the agent on the very next message.
import { getSql } from './db';

export interface Salon {
  id: string;
  slug: string;
  name: string;
  address: string | null;
  phone: string | null;
  timezone: string;
  currency: string;
  slot_step_min: number;
  min_lead_min: number;
  max_days_ahead: number;
  extra_info: string | null;
  owner_email?: string | null;
}

export interface Service {
  id: string;
  name_bg: string;
  name_en: string;
  duration_min: number;
  price: number;
}

export interface Staff {
  id: string;
  name: string;
}

export interface Hours {
  weekday: number;
  open: string; // HH:MM
  close: string;
}

export async function getSalonBySlug(slug: string): Promise<Salon | null> {
  const [row] = await getSql()<Salon[]>`select * from salons where slug = ${slug}`;
  return row ?? null;
}

export async function getSalonById(id: string): Promise<Salon | null> {
  const [row] = await getSql()<Salon[]>`select * from salons where id = ${id}`;
  return row ?? null;
}

export async function listServices(salonId: string): Promise<Service[]> {
  return getSql()<Service[]>`
    select id, name_bg, name_en, duration_min, price from services
    where salon_id = ${salonId} and active order by sort_order, name_bg`;
}

export async function listStaff(salonId: string): Promise<Staff[]> {
  return getSql()<Staff[]>`
    select id, name from staff where salon_id = ${salonId} and active order by name`;
}

export async function listHours(salonId: string): Promise<Hours[]> {
  return getSql()<Hours[]>`
    select weekday, to_char(open_time, 'HH24:MI') as open, to_char(close_time, 'HH24:MI') as close
    from working_hours where salon_id = ${salonId} order by weekday`;
}

/**
 * Finds a service by id or by (partial, case-insensitive) Bulgarian or English name.
 * The model is told to pass the id, but names are accepted to be forgiving.
 */
export function findService(services: Service[], query: string): Service | null {
  const q = query.trim().toLowerCase();
  return (
    services.find((s) => s.id === query.trim()) ??
    services.find((s) => s.name_bg.toLowerCase() === q || s.name_en.toLowerCase() === q) ??
    services.find((s) => s.name_bg.toLowerCase().includes(q) || s.name_en.toLowerCase().includes(q)) ??
    null
  );
}
