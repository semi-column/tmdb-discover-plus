import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:7000',
        changeOrigin: true,
      },
      '^/[A-Za-z0-9_-]+/(manifest\\.json|catalog/|meta/)': {
        target: 'http://localhost:7000',
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: 'dist',
    target: 'es2020',
    rollupOptions: {
      input: {
        main: fileURLToPath(new URL('./index.html', import.meta.url)),
        admin: fileURLToPath(new URL('./admin.html', import.meta.url)),
      },
      output: {
        // Prevent aggressive chunk merging that can cause hoisting issues
        manualChunks: (id) => {
          if (id.includes('node_modules/react') || id.includes('node_modules/react-dom')) {
            return 'react-vendor';
          }
          if (id.includes('node_modules/lucide-react')) {
            return 'lucide';
          }
          if (
            id.includes('node_modules/@dnd-kit/core') ||
            id.includes('node_modules/@dnd-kit/sortable') ||
            id.includes('node_modules/@dnd-kit/utilities')
          ) {
            return 'dnd-kit';
          }
        },
      },
    },
  },
  // Optimize deps to prevent hoisting issues
  optimizeDeps: {
    include: ['react', 'react-dom', 'lucide-react'],
  },
});
