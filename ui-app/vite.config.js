import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath, URL } from 'node:url';

// In development the browser talks to Vite (http://localhost:5173), and Vite forwards /api to the gateway.
// Same origin → no CORS issues, and the refresh-token cookie works like in production.
const gatewayUrl = process.env.VITE_GATEWAY_URL ?? 'http://localhost:8080';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    // `@/` points at src/, so imports read as `@/components/ui/Button` instead of long `../../` paths.
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: gatewayUrl,
        changeOrigin: true,
        // The browser only ever talks to this dev server (same origin). Forward its requests as same-origin requests to
        // the gateway, like nginx does in production; otherwise a dev server on a port missing from the gateway's
        // CORS_ALLOWED_ORIGINS is answered 403.
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
});
