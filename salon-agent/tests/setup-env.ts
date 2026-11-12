// Tests always use TEST_DATABASE_URL (wiped on each run), never DATABASE_URL.
import { loadEnv } from '../scripts/load-env';

loadEnv();
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://postgres@127.0.0.1:54329/salon_test';
