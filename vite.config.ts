import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  build: {
    target: 'es2022',
    sourcemap: false,
    rollupOptions: {
      // Step 3 (2026-09-11): /gesture-synth is a second entry mounting the
      // same main.tsx — one instrument, two URLs. Bundles are shared chunks.
      input: {
        main: 'index.html',
        gestureSynth: 'gesture-synth.html',
      },
      output: {
        manualChunks: {
          vendor: ['react', 'react-dom'],
        },
      },
    },
  },
  server: {
    port: 3000,
  },
  test: {
    environment: 'jsdom',
  },
})
