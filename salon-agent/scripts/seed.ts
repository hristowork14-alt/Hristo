// Usage: DATABASE_URL=... OWNER_EMAIL=you@example.com npm run db:seed
// OWNER_EMAIL = the Supabase Auth user who may open this salon's dashboard.
import { createSql } from '../src/lib/db';
import { seedDemo } from '../src/lib/seed';
import { loadEnv } from './load-env';

loadEnv();
const sql = createSql(process.env.DATABASE_URL!);
seedDemo(sql, process.env.OWNER_EMAIL || null)
  .then((id) => console.log(`demo salon seeded: ${id}`))
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => sql.end());
