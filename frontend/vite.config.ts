import { defineConfig } from 'vitest/config'
import vue from '@vitejs/plugin-vue'
import { fileURLToPath, URL } from 'node:url'

export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    host: true,
    proxy: {
      '/api': 'http://localhost:8080',
      // Test mode only: the local speech sidecar (asr/), used without the Go API.
      '/asr': { target: 'http://127.0.0.1:8765', rewrite: (p) => p.replace(/^\/asr/, '') },
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
})
