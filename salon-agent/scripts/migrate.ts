// Applies every supabase/migrations/*.sql file in name order.
// The files are idempotent (`if not exists`), so running this twice is safe.
// Usage: DATABASE_URL=... npm run db:migrate
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createSql } from '../src/lib/db';
import { loadEnv } from './load-env';

export async function migrate(url: string) {
  const sql = createSql(url);
  const dir = join(process.cwd(), 'supabase/migrations');
  try {
    for (const file of readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()) {
      await sql.unsafe(readFileSync(join(dir, file), 'utf8'));
      console.log(`applied ${file}`);
    }
  } finally {
    await sql.end();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  loadEnv();
  migrate(process.env.DATABASE_URL!).catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
