import { useEffect, useRef, type ReactNode } from 'react'
import { useStore } from '../store'

/** Where the selection sits on screen, in fractions of the frame (0…1, y down); null when nothing is shown. */
export interface ScreenRect {
  x0: number
  x1: number
  y0: number
  y1: number
}

/** The viewport pushes the selection's on-screen box here every frame while rulers are shown. */
export const rulerBridge: { update: ((r: ScreenRect | null) => void) | null } = { update: null }

/** A tick step (in export pixels) that gives about `target` labels along `size`: 1, 2 or 5 × a power of ten. */
function niceStep(size: number, target: number): number {
  const raw = size / target
  const p = 10 ** Math.floor(Math.log10(raw))
  return [1, 2, 5, 10].map((m) => m * p).find((s) => s >= raw) ?? raw
}

function Ticks({ size, vertical }: { size: number; vertical?: boolean }): ReactNode {
  const step = niceStep(size, 8)
  const minor = step / 5
  const ticks: ReactNode[] = []
  for (let v = 0; v <= size + 0.001; v += minor) {
    const major = Math.abs(v / step - Math.round(v / step)) < 1e-6
    const at = `${(v / size) * 100}%`
    ticks.push(
      <i key={v} className={major ? 'major' : undefined} style={vertical ? { top: at } : { left: at }}>
        {major && v > 0 && v < size && <span>{Math.round(v)}</span>}
      </i>
    )
  }
  return <>{ticks}</>
}

/**
 * Rulers along the top and left of the frame, measured in export pixels, with centre and rule-of-thirds guides.
 * The selection shows as a band on each ruler, and the centre guides turn green when it is centred.
 */
export function Rulers(): ReactNode {
  const show = useStore((s) => s.settings.showRulers)
  const w = useStore((s) => s.settings.exportWidth)
  const h = useStore((s) => s.settings.exportHeight)
  const bandX = useRef<HTMLDivElement>(null)
  const bandY = useRef<HTMLDivElement>(null)
  const centreX = useRef<HTMLDivElement>(null)
  const centreY = useRef<HTMLDivElement>(null)
  const readout = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!show) return
    rulerBridge.update = (r) => {
      const bx = bandX.current
      const by = bandY.current
      if (!bx || !by) return
      const visible = !!r
      bx.style.display = by.style.display = visible ? '' : 'none'
      readout.current!.style.display = visible ? '' : 'none'
      let cx = false
      let cy = false
      if (r) {
        bx.style.left = `${r.x0 * 100}%`
        bx.style.width = `${(r.x1 - r.x0) * 100}%`
        by.style.top = `${r.y0 * 100}%`
        by.style.height = `${(r.y1 - r.y0) * 100}%`
        // Centred within half a percent of the frame.
        cx = Math.abs((r.x0 + r.x1) / 2 - 0.5) < 0.005
        cy = Math.abs((r.y0 + r.y1) / 2 - 0.5) < 0.005
        const px = (f: number, size: number): number => Math.round(f * size)
        readout.current!.textContent =
          `x ${px((r.x0 + r.x1) / 2, w)} · y ${px((r.y0 + r.y1) / 2, h)} · ` +
          `${px(r.x1 - r.x0, w)} × ${px(r.y1 - r.y0, h)} px`
      }
      centreX.current!.classList.toggle('aligned', cx)
      centreY.current!.classList.toggle('aligned', cy)
    }
    return () => {
      rulerBridge.update = null
    }
  }, [show, w, h])
  if (!show) return null
  return (
    <div className="rulers" aria-hidden>
      <div className="guide third v" style={{ left: '33.333%' }} />
      <div className="guide third v" style={{ left: '66.667%' }} />
      <div className="guide third h" style={{ top: '33.333%' }} />
      <div className="guide third h" style={{ top: '66.667%' }} />
      <div ref={centreX} className="guide centre v" style={{ left: '50%' }} />
      <div ref={centreY} className="guide centre h" style={{ top: '50%' }} />
      <div className="ruler top">
        <div ref={bandX} className="ruler-band" style={{ display: 'none' }} />
        <Ticks size={w} />
      </div>
      <div className="ruler left">
        <div ref={bandY} className="ruler-band" style={{ display: 'none' }} />
        <Ticks size={h} vertical />
      </div>
      <div className="ruler-corner" />
      <div ref={readout} className="ruler-readout" style={{ display: 'none' }} />
    </div>
  )
}
