import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const suppressWsProxyErrors = () => {
  return {
    name: 'suppress-ws-proxy-errors',
    configureServer(server) {
      if (server.config.logger) {
        const originalError = server.config.logger.error;
        server.config.logger.error = (msg: string, options?: any) => {
          if (
            msg.includes('ws proxy error') ||
            msg.includes('ws proxy socket error') ||
            (msg.includes('ECONNABORTED') && msg.includes('vite'))
          ) {
            return;
          }
          originalError.call(server.config.logger, msg, options);
        };
      }
      
      const originalConsoleError = console.error;
      console.error = (...args: any[]) => {
        const message = args.join(' ');
        if (
          message.includes('ws proxy error') ||
          message.includes('ws proxy socket error') ||
          (message.includes('ECONNABORTED') && message.includes('vite'))
        ) {
          return;
        }
        originalConsoleError.apply(console, args);
      };
    },
  };
};

export default defineConfig({
  plugins: [react(), suppressWsProxyErrors()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: process.env.VITE_PROXY_TARGET ?? 'http://localhost:5001',
        changeOrigin: true,
      },
      '/socket.io': {
        target: process.env.VITE_PROXY_TARGET ?? 'http://localhost:5001',
        ws: true,
        changeOrigin: true,
        secure: false,
        configure: (proxy) => {
          const ignorableErrors = ['ECONNABORTED', 'ECONNRESET', 'EPIPE', 'ETIMEDOUT'];
          const handleError = (err: NodeJS.ErrnoException) => {
            if (err.code && ignorableErrors.includes(err.code)) {
              return;
            }
          };
          
          proxy.on('error', handleError);
          proxy.on('proxyReqWs', (proxyReq, _req, _socket) => {
            proxyReq.on('error', handleError);
            _socket.on('error', handleError);
          });
          proxy.on('proxyRes', (proxyRes) => {
            proxyRes.on('error', handleError);
          });
        },
      },
      '/uploads': {
        target: process.env.VITE_PROXY_TARGET ?? 'http://localhost:5001',
        changeOrigin: true,
      },
    },
  },
});

