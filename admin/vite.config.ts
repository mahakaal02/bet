import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  // Served under /admin/ both behind the nginx proxy (:8000/admin/) and
  // on the direct dev port (:5173/admin/). A non-root base makes Vite
  // emit every dev asset (/@vite/client, /src/*, /@react-refresh, HMR ws)
  // under /admin/, so the reverse proxy needs a single /admin/ location
  // instead of forwarding each Vite-internal root path individually.
  base: '/admin/',
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:4000',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ''),
      },
      '/uploads': {
        target: 'http://localhost:4000',
        changeOrigin: true,
      },
    },
  },
});
