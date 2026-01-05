import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

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
    },
  },
  build: {
    outDir: 'dist',
    // Disable minification temporarily to debug, or use esbuild
    // which has better handling of TDZ (Temporal Dead Zone) issues
    target: 'es2020',
    rollupOptions: {
      output: {
        // Prevent aggressive chunk merging that can cause hoisting issues
        manualChunks: {
          'react-vendor': ['react', 'react-dom'],
          'lucide': ['lucide-react'],
        },
      },
    },
  },
  // Optimize deps to prevent hoisting issues
  optimizeDeps: {
    include: ['react', 'react-dom', 'lucide-react'],
  },
})
