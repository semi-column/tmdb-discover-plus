import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/unit/**/*.test.{ts,js}'],
    environment: 'node',
    globals: true,
    setupFiles: ['tests/unit/setup.ts'],
    testTimeout: 10000,
  },
});
