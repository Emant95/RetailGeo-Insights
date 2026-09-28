import { defineConfig } from 'vitest/config';
import path from 'node:path';
export default defineConfig({
  resolve: { alias: { '@retailgeo/core': path.resolve(__dirname, 'packages/core/src/index.ts') } },
  test: { include: ['packages/**/test/**/*.test.ts', 'apps/api/test/**/*.test.ts'], testTimeout: 30000, fileParallelism: false },
});
