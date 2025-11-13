import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: process.env.VITE_PROXY_TARGET ?? 'http://localhost:5001',
        changeOrigin: true,
      },
      '/socket.io': {
        target:'http://localhost:5001',
        ws: true,
      },
      '/uploads': {
        target: process.env.VITE_PROXY_TARGET ?? 'http://localhost:5001',
        changeOrigin: true,
      },
    },
  },
});

