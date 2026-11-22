// Demo data: one fictional barbershop with 5 services, 2 barbers and Mon-Sat hours.
// Used by `npm run db:seed` and by the tests. Re-running replaces the demo salon.
import type { Sql } from './db';

export const DEMO_SLUG = 'demo-barber';

export const DEMO_SERVICES = [
  { name_bg: 'Мъжко подстригване', name_en: "Men's haircut", duration_min: 30, price: 15 },
  { name_bg: 'Подстригване и брада', name_en: 'Haircut and beard', duration_min: 60, price: 25 },
  { name_bg: 'Оформяне на брада', name_en: 'Beard trim', duration_min: 30, price: 10 },
  { name_bg: 'Детско подстригване', name_en: "Kids' haircut", duration_min: 30, price: 12 },
  { name_bg: 'Бръснене с горещ пешкир', name_en: 'Hot towel shave', duration_min: 45, price: 18 },
];

export const DEMO_STAFF = ['Иван', 'Георги'];

// ISO weekday -> [open, close]. Sunday (7) has no row = closed.
export const DEMO_HOURS: Record<number, [string, string]> = {
  1: ['09:00', '19:00'],
  2: ['09:00', '19:00'],
  3: ['09:00', '19:00'],
  4: ['09:00', '19:00'],
  5: ['09:00', '19:00'],
  6: ['10:00', '16:00'],
};

export async function seedDemo(sql: Sql, ownerEmail: string | null = null): Promise<string> {
  return sql.begin(async (tx) => {
    await tx`delete from salons where slug = ${DEMO_SLUG}`;
    const [salon] = await tx`
      insert into salons (slug, name, address, phone, timezone, currency, slot_step_min, extra_info, owner_email)
      values (${DEMO_SLUG}, 'Барбър Студио Витоша', 'ул. Витоша 1, София', '+359 888 123 456',
              'Europe/Sofia', 'EUR', 30,
              'Плащане в брой или с карта. Паркиране на улицата (синя зона).', ${ownerEmail})
      returning id`;
    for (const [i, s] of DEMO_SERVICES.entries()) {
      await tx`insert into services (salon_id, name_bg, name_en, duration_min, price, sort_order)
               values (${salon.id}, ${s.name_bg}, ${s.name_en}, ${s.duration_min}, ${s.price}, ${i})`;
    }
    for (const name of DEMO_STAFF) {
      await tx`insert into staff (salon_id, name) values (${salon.id}, ${name})`;
    }
    for (const [day, [open, close]] of Object.entries(DEMO_HOURS)) {
      await tx`insert into working_hours (salon_id, weekday, open_time, close_time)
               values (${salon.id}, ${Number(day)}, ${open}, ${close})`;
    }
    return salon.id as string;
  });
}
