// Usage: DATABASE_URL=... npm run db:seed
import { createSql } from '../src/lib/db';
import { seedDemo } from '../src/lib/seed';
import { loadEnv } from './load-env';

loadEnv();
const sql = createSql(process.env.DATABASE_URL!);
seedDemo(sql)
  .then((id) => console.log(`demo salon seeded: ${id}`))
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => sql.end());
