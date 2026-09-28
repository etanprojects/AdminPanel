import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

const backend = 'http://localhost:5148'

// Build trafia do wwwroot aplikacji .NET - w produkcji SPA i API działają pod jednym originem.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': backend,
      '/mock': backend,
      '/hubs': { target: backend, ws: true },
    },
  },
  build: {
    outDir: '../AdminPanel.Api/wwwroot',
    emptyOutDir: true,
  },
})
