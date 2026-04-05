import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api/off': {
        // Use .org for production, .net is staging (fallback if .org is down)
        target: 'https://world.openfoodfacts.net',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/off/, ''),
        headers: {
          'User-Agent': 'FoodTracker/1.0 (david@example.com)',
        },
      },
    },
  },
})
