import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/integration/**/*.test.ts'],
    testTimeout: 120_000,
    globalSetup: ['./tests/integration/global-setup.ts'],
    // Integration tests share a single Docker-backed Node-RED runtime.
    // `fileParallelism: false` runs test files sequentially in one worker,
    // which is the vitest 4 idiom for what was previously
    // `pool: 'forks', poolOptions: { forks: { singleFork: true } }`.
    fileParallelism: false,
  },
});
