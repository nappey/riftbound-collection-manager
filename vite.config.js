import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  // Relative paths so Electron can load dist/index.html from file://
  base: './',
  server: {
    proxy: {
      // Browser-only dev fallback — Electron uses direct URL + CORS header injection
      '/tcgcsv': {
        target: 'https://tcgcsv.com',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/tcgcsv/, ''),
      },
      // Netdeck.gg card API (Cyberpunk TCG) — same browser-only fallback
      '/netdeck': {
        target: 'https://api.netdeck.gg',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/netdeck/, ''),
      },
    },
  },
})
