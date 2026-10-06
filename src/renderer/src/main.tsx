import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { AppErrorBoundary } from './components/AppErrorBoundary'
import { useStore } from './store'
import './styles.css'

// Handle for automated UI tests: development builds, or a build made with RENDERER_VITE_TEST_HOOKS=1.
if (import.meta.env.DEV || import.meta.env.RENDERER_VITE_TEST_HOOKS === '1')
  (window as unknown as { __blockframe: typeof useStore }).__blockframe = useStore

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AppErrorBoundary>
      <App />
    </AppErrorBoundary>
  </StrictMode>
)
