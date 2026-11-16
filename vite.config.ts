import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '^/(api(?:/|$)|sync/jira(?:[?]|$)|scoreboard(?:[?]|$)|tasks/[^/]+/stages(?:[?]|$)|interns/[^/]+/metrics(?:[?]|$)|flags(?:/[^/]+/resolve)?(?:[?]|$))': 'http://127.0.0.1:8080',
    },
  },
  test: {
    environment: 'jsdom', setupFiles: ['./src/test/setup.ts'],
    env: { VITE_API_MODE: 'mock' },
    coverage: {
      provider: 'v8', reporter: ['text', 'html', 'json-summary'],
      include: ['src/**/*.{ts,tsx}'], exclude: ['src/test/**', 'src/**/*.test.*', 'src/main.tsx'],
      thresholds: { lines: 81, statements: 81 }
    }
  }
});
