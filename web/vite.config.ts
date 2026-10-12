import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// Port 5173 on localhost: the extension's bridge only connects to local origins.
export default defineConfig({
  plugins: [react()],
  server: { port: 5173, strictPort: true },
  preview: { port: 5173, strictPort: true },
})
