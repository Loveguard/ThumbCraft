import { resolve } from 'node:path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import type { Plugin } from 'vite'
import react from '@vitejs/plugin-react'

const shared = { '@shared': resolve(__dirname, 'src/shared') }

/** The dev server needs WebSockets for hot reload; the shipped app must not be able to open any. */
const productionCsp = (): Plugin => ({
  name: 'production-csp',
  apply: 'build',
  transformIndexHtml: (html: string) => html.replace(/ ws:/, '')
})

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    resolve: { alias: shared }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    resolve: { alias: shared }
  },
  renderer: {
    root: 'src/renderer',
    resolve: { alias: { ...shared, '@renderer': resolve(__dirname, 'src/renderer/src') } },
    plugins: [react(), productionCsp()],
    build: {
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
  }
})
