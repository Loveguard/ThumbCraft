import { useState, type ReactNode } from 'react'
import { Scissors } from 'lucide-react'
import { cutOutImage } from '../backgroundRemoval'
import { errorText } from '../errors'
import { useStore, type ImageObject } from '../store'

/** Removes the background behind the person in a photo. */
export function CutoutControls({ o }: { o: ImageObject }): ReactNode {
  const [busy, setBusy] = useState(false)
  return (
    <button
      disabled={busy}
      title="Keeps the person in the photo and removes everything else. Runs on this computer; nothing is uploaded."
      onClick={async () => {
        setBusy(true)
        try {
          await cutOutImage(o)
          useStore.getState().setStatus('Background removed (Ctrl+Z brings it back)')
        } catch (e) {
          useStore.getState().setStatus(`Background removal failed: ${errorText(e)}`)
        } finally {
          setBusy(false)
        }
      }}
    >
      <Scissors size={15} /> {busy ? 'Removing background…' : 'Remove background'}
    </button>
  )
}
