import { defineConfig } from 'vite';
// Also brings Vitest's `test` options into Vite's config type.
import { configDefaults } from 'vitest/config';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath, URL } from 'node:url';

// In development the browser talks to Vite (http://localhost:5173), and Vite forwards /api to the gateway.
// Same origin → no CORS issues, and the refresh-token cookie works like in production.
const gatewayUrl = process.env.VITE_GATEWAY_URL ?? 'http://localhost:8080';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  server: {
    port: 5173,
    // Playwright writes traces and reports (HTML) under frontend/; without this, a test run reloads every open dev page.
    watch: { ignored: ['**/test-results*/**', '**/playwright-report*/**'] },
    proxy: {
      '/api': {
        target: gatewayUrl,
        changeOrigin: true,
        // The browser only ever talks to this dev server (same origin). Forward its requests as same-origin requests to
        // the gateway, like nginx does in production; otherwise a dev server on a port missing from the gateway's
        // CORS_ALLOWED_ORIGINS (e.g. a second one on 5174 for the e2e tests) is answered 403.
        configure: (proxy) => {
          proxy.on('proxyReq', (proxyReq) => {
            if (proxyReq.getHeader('origin')) {
              proxyReq.setHeader('origin', new URL(gatewayUrl).origin);
            }
          });
        },
      },
    },
  },
  build: {
    sourcemap: true,
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    css: false,
    restoreMocks: true,
    // e2e/ holds the Playwright browser tests (npm run test:e2e); Vitest must not pick them up.
    exclude: [...configDefaults.exclude, 'e2e/**'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.{ts,tsx}'],
      exclude: ['src/**/*.test.{ts,tsx}', 'src/test/**', 'src/main.tsx', 'src/vite-env.d.ts', 'src/**/types.ts'],
      reporter: ['text-summary', 'html', 'json-summary'],
    },
  },
});
