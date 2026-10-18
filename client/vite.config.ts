import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// Dev server proxies /api and /socket.io to the Express backend so the client
// never needs CORS in development.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5273,
    strictPort: true,
    proxy: {
      '/api': 'http://localhost:4000',
      '/socket.io': { target: 'http://localhost:4000', ws: true },
    },
  },
  test: { environment: 'node' },
});
