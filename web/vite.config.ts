import { cloudflare } from '@cloudflare/vite-plugin'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// Port 5173 on localhost: the extension's bridge only connects to local origins.
// The cloudflare plugin runs the /api Worker (and a local D1) inside the same dev server.
export default defineConfig({
  plugins: [react(), cloudflare()],
  server: { port: 5173, strictPort: true },
  preview: { port: 5173, strictPort: true },
})
