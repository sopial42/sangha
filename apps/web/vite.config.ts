import path from 'node:path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// One address in dev as in production: the web takes Sangha's port (8787) and hands /api to the server,
// which `make dev` moves to an internal port. Proxy target overridable (e.g. a mock server).
const port = Number(process.env.SANGHA_PORT ?? 8787)
const apiPort = process.env.SANGHA_API_PORT ?? '8788'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { alias: { '@': path.resolve(import.meta.dirname, 'src') } },
  // Only the app: scripts/pebbles/render.html is a build tool that loads three.js from a CDN.
  optimizeDeps: { entries: ['index.html'] },
  server: { host: '127.0.0.1', port, strictPort: true, proxy: { '/api': `http://127.0.0.1:${apiPort}` } },
})
