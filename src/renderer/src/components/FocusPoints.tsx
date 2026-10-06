import { useRef, type ReactNode } from 'react'
import { Plus, X } from 'lucide-react'
import { useStore } from '../store'
import { MAX_FOCUS_POINTS } from './focusBlur'

const clamp = (v: number): number => Math.min(0.98, Math.max(0.02, v))

/**
 * The focus points of the depth-of-field effect, drawn over the viewport (never part of the image). Drag a
 * point onto a character and the character comes into focus; slide it onto the tree behind and the tree does.
 * The + on a point's edge adds another one, so several subjects can be sharp at once.
 */
export function FocusPoints(): ReactNode {
  const on = useStore((s) => s.effects.depthOfField)
  const points = useStore((s) => s.effects.focusPoints)
  const layer = useRef<HTMLDivElement>(null)
  if (!on) return null
  const set = (next: { x: number; y: number }[]): void => useStore.getState().setEffects({ focusPoints: next })

  const drag = (i: number) => (e: React.PointerEvent) => {
    if (e.button !== 0 || !layer.current) return
    e.preventDefault()
    e.stopPropagation()
    const el = e.currentTarget as HTMLElement
    el.setPointerCapture(e.pointerId)
    const rect = layer.current.getBoundingClientRect()
    const move = (ev: PointerEvent): void => {
      const now = useStore.getState().effects.focusPoints
      set(
        now.map((p, j) =>
          j === i
            ? { x: clamp((ev.clientX - rect.left) / rect.width), y: clamp((ev.clientY - rect.top) / rect.height) }
            : p
        )
      )
    }
    const up = (): void => {
      el.removeEventListener('pointermove', move)
      el.removeEventListener('pointerup', up)
      el.removeEventListener('pointercancel', up)
    }
    el.addEventListener('pointermove', move)
    el.addEventListener('pointerup', up)
    el.addEventListener('pointercancel', up)
  }

  return (
    <div ref={layer} className="focus-layer">
      {points.map((p, i) => (
        <div
          key={i}
          className="focus-point"
          style={{ left: `${p.x * 100}%`, top: `${p.y * 100}%` }}
          title="Drag onto what should be in focus"
          onPointerDown={drag(i)}
        >
          <span className="focus-ring" />
          <span className="focus-dot" />
          {points.length < MAX_FOCUS_POINTS && (
            <button
              className="focus-add"
              title="Add another focus point"
              aria-label="Add another focus point"
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation()
                set([...points, { x: clamp(p.x + 0.1), y: clamp(p.y) }])
              }}
            >
              <Plus size={12} />
            </button>
          )}
          {points.length > 1 && (
            <button
              className="focus-remove"
              title="Remove this focus point"
              aria-label="Remove this focus point"
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation()
                set(points.filter((_, j) => j !== i))
              }}
            >
              <X size={10} />
            </button>
          )}
        </div>
      ))}
    </div>
  )
}
