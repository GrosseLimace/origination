/// <reference types="vitest" />
import angular from '@analogjs/vite-plugin-angular';
import { defineConfig } from 'vitest/config';
import { resolve } from 'path';

export default defineConfig({
  // The Angular plugin AOT-compiles components (incl. external templateUrl/styleUrls)
  // during transform, so component tests can render real DOM under Vitest.
  plugins: [angular()],
  resolve: {
    alias: [
      { find: '@core', replacement: resolve(__dirname, 'src/app/core') },
      { find: '@shared', replacement: resolve(__dirname, 'src/app/shared') },
      // One alias per module, to its public index.ts only, as in tsconfig.json: "@features/x/deep/path" doesn't resolve.
      { find: /^@features\/([a-z-]+)$/, replacement: resolve(__dirname, 'src/app/features') + '/$1/index.ts' },
      { find: '@models', replacement: resolve(__dirname, 'src/app/models/index.ts') },
      { find: '@env', replacement: resolve(__dirname, 'src/environments') },
      { find: '@testing', replacement: resolve(__dirname, 'src/testing') },
    ]
  },
  test: {
    environment: 'happy-dom',
    globals: true,
    setupFiles: ['./src/setup-tests.ts'],
    // Unit/component specs only. Playwright E2E specs live under tests/e2e and are run by
    // Playwright, not Vitest.
    include: ['src/**/*.spec.ts'],
    coverage: {
      provider: 'v8',
      // lcov is consumed by the CI diff-coverage step (see .github/workflows/ci.yml).
      reporter: ['text', 'html', 'lcov'],
      exclude: ['node_modules/', 'src/environments/']
    }
  }
});
