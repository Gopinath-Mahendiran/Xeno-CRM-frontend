import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  base: '/',
  build: {
    // Output directly into the Django project's static_frontend folder
    outDir: path.resolve(__dirname, '../../../xeno-CRM/xeno-crm/static_frontend'),
    emptyOutDir: true,
    sourcemap: false,
    rollupOptions: {
      output: {
        // Stable chunk names for WhiteNoise caching
        manualChunks(id) {
          if (id.includes('node_modules')) {
            if (id.includes('react') || id.includes('react-dom')) {
              return 'vendor';
            }
            if (id.includes('recharts')) {
              return 'charts';
            }
          }
        },
      },
    },
  },
  server: {
    // Dev proxy — forwards API calls to Django in development
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:8000',
        changeOrigin: true,
      },
    },
  },
})
