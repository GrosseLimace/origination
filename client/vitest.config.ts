import { defineConfig } from 'vitest/config';
import { resolve } from 'path';

export default defineConfig({
  resolve: {
    alias: {
      '@core': resolve(__dirname, 'src/app/core'),
      '@shared': resolve(__dirname, 'src/app/shared'),
      '@features': resolve(__dirname, 'src/app/features'),
      '@models': resolve(__dirname, 'src/app/models/index.ts'),
      '@env': resolve(__dirname, 'src/environments'),
    }
  },
  test: {
    environment: 'happy-dom',
    globals: true,
    setupFiles: ['./src/setup-tests.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      exclude: ['node_modules/', 'src/environments/']
    }
  }
});
