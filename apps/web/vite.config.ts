import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// One address in dev as in production: the web takes Sangha's port (8787) and hands /api to the server,
// which `make dev` moves to an internal port. Proxy target overridable (e.g. a mock server).
const port = Number(process.env.SANGHA_PORT ?? 8787)
const apiPort = process.env.SANGHA_API_PORT ?? '8788'

export default defineConfig({
  plugins: [react()],
  server: { host: '127.0.0.1', port, strictPort: true, proxy: { '/api': `http://127.0.0.1:${apiPort}` } },
})
