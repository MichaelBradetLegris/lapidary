import { configDefaults, defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
    // Real-file-system timing tests run separately: npm run test:slow (files.5).
    exclude: [...configDefaults.exclude, 'test/slow/**'],
    reporters: ['default']
  }
});
