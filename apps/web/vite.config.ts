import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// Proxy target overridable for local testing against another server (e.g. a mock), the real one stays the default.
const apiPort = process.env.SANGHA_API_PORT ?? '8787'

export default defineConfig({
  plugins: [react()],
  server: { port: 5173, proxy: { '/api': `http://127.0.0.1:${apiPort}` } },
})
