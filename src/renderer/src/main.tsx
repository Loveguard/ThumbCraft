import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './styles.css'

const root = document.getElementById('root')!

/** Shown when the app's code can't even load, so a failure is never just a dark window. */
function showStartupError(e: unknown): void {
  console.error('ThumbCraft failed to start:', e)
  const box = document.createElement('div')
  box.className = 'startup-error'
  const title = document.createElement('strong')
  title.textContent = 'ThumbCraft could not start.'
  const detail = document.createElement('pre')
  detail.textContent = e instanceof Error ? `${e.message}\n\n${e.stack ?? ''}` : String(e)
  const hint = document.createElement('span')
  hint.textContent =
    'Press Ctrl+R (Cmd+R on a Mac) to try again. If this keeps happening, please report the text above.'
  box.append(title, detail, hint)
  root.replaceChildren(box)
}

// Loaded dynamically so that an error anywhere in the app's code shows up on screen instead of a blank window.
Promise.all([import('./App'), import('./components/AppErrorBoundary'), import('./store')])
  .then(([{ App }, { AppErrorBoundary }, { useStore }]) => {
    // Handle for automated UI tests: development builds, or a build made with RENDERER_VITE_TEST_HOOKS=1.
    if (import.meta.env.DEV || import.meta.env.RENDERER_VITE_TEST_HOOKS === '1') {
      ;(window as unknown as { __blockframe: typeof useStore }).__blockframe = useStore
      void import('./capture').then((m) => ((window as unknown as { __capture: typeof m }).__capture = m))
    }
    createRoot(root).render(
      <StrictMode>
        <AppErrorBoundary>
          <App />
        </AppErrorBoundary>
      </StrictMode>
    )
  })
  .catch(showStartupError)
