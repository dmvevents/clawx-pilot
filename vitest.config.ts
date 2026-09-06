import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';

export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./tests/setup.ts'],
    include: ['tests/unit/**/*.{test,spec}.{ts,tsx}'],
    // CLWX-83: combined Outlook-suite runs OOM'd the default worker heap
    // (Node 26.3 era). Give each fork explicit headroom so targeted
    // multi-suite runs cannot hit the default old-space ceiling.
    // NOTE: must be TOP-LEVEL test.execArgv — Vitest 4 removed
    // poolOptions.*.execArgv (it warns and ignores the value).
    execArgv: ['--max-old-space-size=4096'],
    coverage: {
      reporter: ['text', 'json', 'html'],
      exclude: ['node_modules/', 'tests/'],
    },
  },
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
      '@electron': resolve(__dirname, 'electron'),
    },
  },
});
