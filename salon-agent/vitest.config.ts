import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  test: {
    environment: 'node',
    // Tests share one test database, so run files one at a time.
    fileParallelism: false,
    testTimeout: 120_000,
    setupFiles: ['./tests/setup-env.ts'],
  },
});
