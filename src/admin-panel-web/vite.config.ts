import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

const backend = 'http://localhost:5148'

export default defineConfig({
  plugins: [react()],
  base: './',
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
    rollupOptions: {
      output: {
        manualChunks: {
          mantine: ['@mantine/core', '@mantine/hooks', '@mantine/notifications'],
          'mantine-dates': ['@mantine/dates', 'dayjs'],
          signalr: ['@microsoft/signalr'],
          oidc: ['oidc-client-ts'],
        },
      },
    },
  },
})
