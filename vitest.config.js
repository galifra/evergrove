import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

// Tests run from the repository root. (The app build uses `site/` as its root, so
// it has its own config in vite.config.js.)
export default defineConfig({
  plugins: [react()],
  test: {
    include: ['packages/**/*.test.js', 'apps/**/*.test.js', 'tests/**/*.test.js', 'server/**/*.test.js'],
    exclude: ['**/node_modules/**', 'dist/**'],
  },
})
