import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
    // storage/index.ts resolves ADFORGE_DATA_DIR once at import time — point
    // it at a throwaway directory during tests so nothing writes into the
    // real ./data used by a locally-running server, or gets committed.
    env: {
      ADFORGE_DATA_DIR: path.join(process.cwd(), '.vitest-data'),
    },
    coverage: {
      provider: 'v8',
      reporter: ['text', 'text-summary'],
      include: ['src/**/*.ts'],
      exclude: ['src/index.ts', 'src/tools/**'], // MCP wiring — exercised by the e2e smoke test instead
    },
  },
});
