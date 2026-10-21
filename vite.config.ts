import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const SERVER_PORT = Number(process.env.PORT ?? 3001);

export default defineConfig({
  plugins: [react()],
  build: { outDir: 'dist/client', emptyOutDir: true },
  server: {
    port: 5173,
    proxy: {
      '/socket.io': { target: `http://localhost:${SERVER_PORT}`, ws: true },
    },
  },
  test: { environment: 'node', include: ['tests/**/*.test.ts'], testTimeout: 120000 },
} as any);
