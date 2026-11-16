// Builds the interface for the Tauri shell (the same renderer the Electron build uses, from src/renderer).
import { resolve } from 'node:path'
import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'

/** The dev server needs WebSockets for hot reload; the shipped app must not be able to open any. */
const productionCsp = (): Plugin => ({
  name: 'production-csp',
  apply: 'build',
  transformIndexHtml: (html: string) => html.replace(/ ws:/, '')
})

export default defineConfig({
  root: resolve(__dirname, 'src/renderer'),
  // Keeps the Electron build's variable names (RENDERER_VITE_TEST_HOOKS) working.
  envPrefix: ['VITE_', 'RENDERER_VITE_'],
  clearScreen: false,
  resolve: {
    alias: {
      '@shared': resolve(__dirname, 'src/shared'),
      '@renderer': resolve(__dirname, 'src/renderer/src')
    }
  },
  plugins: [react(), productionCsp()],
  // A port of its own, so this can run next to the Electron version's dev server.
  server: { port: 5174, strictPort: true },
  build: {
    outDir: resolve(__dirname, 'out/renderer'),
    emptyOutDir: true,
    // WebView2 (Windows) is current Chromium; macOS 11+ ships Safari 14+ WebKit.
    target: ['es2022', 'chrome105', 'safari15'],
    minify: true,
    rollupOptions: {
      output: {
        // Libraries change less often than app code; separate chunks also parse in parallel.
        manualChunks: (id) =>
          id.includes('node_modules/three/')
            ? 'three'
            : /node_modules\/(react|react-dom|scheduler)\//.test(id)
              ? 'react'
              : /node_modules\/(postprocessing|n8ao|@react-three)\//.test(id)
                ? 'r3f'
                : undefined
      }
    }
  }
})
