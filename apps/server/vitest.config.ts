import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node',
    globals: false,
    // 编排相关用例包含真实等待（轮询/退避），给足超时
    testTimeout: 30_000,
    hookTimeout: 30_000,
    pool: 'forks',
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      include: ['src/**/*.ts'],
      exclude: ['src/scripts/**', 'src/server.ts', 'src/db/seed.ts'],
    },
  },
});
