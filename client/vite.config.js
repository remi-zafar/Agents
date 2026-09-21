import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * The browser must never talk to localhost:8000 directly — the user's browser
 * is not this sandbox. Everything goes through relative /api URLs that Vite
 * proxies to the agent server, so the preview origin serves both UI and API.
 */
export default defineConfig({
  plugins: [react()],
  server: {
    host: '0.0.0.0',
    port: Number(process.env.CLIENT_PORT) || 3000,
    strictPort: true,
    allowedHosts: true,
    proxy: {
      '/api': {
        target: `http://127.0.0.1:${process.env.PORT || 8000}`,
        changeOrigin: true,
      },
    },
  },
  preview: {
    host: '0.0.0.0',
    port: Number(process.env.CLIENT_PORT) || 3000,
    allowedHosts: true,
  },
});
