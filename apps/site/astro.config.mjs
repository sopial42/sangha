import { fileURLToPath } from 'node:url'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'astro/config'

export default defineConfig({
  // Set `site` to the page's domain once it has one: it makes the social preview image URL absolute.
  vite: {
    plugins: [tailwindcss()],
    // The pebbles are the app's own 3D renders: one source of truth, shared with apps/web.
    resolve: { alias: { '@pebbles': fileURLToPath(new URL('../web/src/assets/pebbles', import.meta.url)) } },
  },
})
