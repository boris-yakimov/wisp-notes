import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'
import { logosPlugin } from './logosPlugin.ts'

export default defineConfig({
  plugins: [react(), logosPlugin()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
    restoreMocks: true,
    env: { VITE_GOOGLE_CLIENT_ID: 'test-client-id' },
  },
})
