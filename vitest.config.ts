import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    pool: 'threads',
    maxWorkers: 1,
    minWorkers: 1
  }
});
