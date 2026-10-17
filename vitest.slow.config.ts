import { defineConfig } from 'vitest/config';

/* Timing-dependent tests against the real file system (files.5). Run with
   `npm run test:slow`; `npm test` leaves them out. */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/slow/**/*.test.ts'],
    testTimeout: 20000,
    reporters: ['default']
  }
});
