/// <reference types="vitest" />
import angular from '@analogjs/vite-plugin-angular';
import { defineConfig } from 'vitest/config';
import { resolve } from 'path';

export default defineConfig({
  // The Angular plugin AOT-compiles components (incl. external templateUrl/styleUrls)
  // during transform, so component tests can render real DOM under Vitest.
  plugins: [angular()],
  resolve: {
    alias: {
      '@core': resolve(__dirname, 'src/app/core'),
      '@shared': resolve(__dirname, 'src/app/shared'),
      '@features': resolve(__dirname, 'src/app/features'),
      '@models': resolve(__dirname, 'src/app/models/index.ts'),
      '@env': resolve(__dirname, 'src/environments'),
      '@testing': resolve(__dirname, 'src/testing'),
      // Shared-lib aliases (mirror tsconfig.json). The mobile app reuses the desktop's
      // framework-free models and utils read-only through these.
      '@libs/models': resolve(__dirname, 'src/app/models/index.ts'),
      '@libs/utils': resolve(__dirname, 'src/app/shared/utils'),
      '@mobile': resolve(__dirname, 'projects/mobile/src/app'),
      '@mobile-env': resolve(__dirname, 'projects/mobile/src/environments'),
    }
  },
  test: {
    environment: 'happy-dom',
    globals: true,
    setupFiles: ['./src/setup-tests.ts'],
    // Unit/component specs only. Playwright E2E specs live under tests/e2e and are run by
    // Playwright, not Vitest. Covers both Angular projects: the desktop app under src/ and the
    // mobile app under projects/mobile/.
    include: ['src/**/*.spec.ts', 'projects/mobile/src/**/*.spec.ts'],
    coverage: {
      provider: 'v8',
      // lcov is consumed by the CI diff-coverage step (see .github/workflows/ci.yml).
      reporter: ['text', 'html', 'lcov'],
      exclude: ['node_modules/', 'src/environments/', 'projects/mobile/src/environments/', 'projects/mobile/src/app/core/api/api-types.ts']
    }
  }
});
