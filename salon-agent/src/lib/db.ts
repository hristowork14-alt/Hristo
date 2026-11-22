// One shared Postgres connection pool (postgres.js).
// Works with local Postgres and with Supabase (use the "Transaction pooler" URL, port 6543).
import postgres from 'postgres';

export type Sql = postgres.Sql;

let pool: Sql | null = null;

export function getSql(): Sql {
  if (pool) return pool;
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is not set (see .env.example)');
  pool = createSql(url);
  return pool;
}

export function createSql(url: string): Sql {
  return postgres(url, {
    max: 5,
    // Supabase's transaction pooler does not support prepared statements.
    prepare: false,
    // numeric columns (prices) come back as JS numbers instead of strings.
    types: { numeric: { to: 1700, from: [1700], serialize: String, parse: Number } },
    onnotice: () => {},
  });
}

/** Lets tests point the app at the test database. */
export function setSql(sql: Sql) {
  pool = sql;
}
