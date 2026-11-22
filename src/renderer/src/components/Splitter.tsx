import type { ReactNode } from 'react'
import { useLayout, type PanelSize } from '../layout'

/** How small and big each panel may be dragged (px); the timeline's top is also kept off the canvas's toolbar. */
const LIMITS: Record<PanelSize, [number, number]> = { asset: [240, 640], inspector: [240, 600], timeline: [110, 600] }

/**
 * The edge of a panel to drag it bigger or smaller; a double-click puts it back. It sizes the element beside it:
 * the one before it (the asset panel), after it (the inspector) or around it (the timeline, by its top edge).
 */
export function Splitter({ panel }: { panel: PanelSize }): ReactNode {
  const setSize = useLayout((s) => s.setSize)
  const vertical = panel === 'timeline'
  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>): void => {
    const handle = e.currentTarget
    const target =
      panel === 'asset'
        ? handle.previousElementSibling
        : panel === 'inspector'
          ? handle.nextElementSibling
          : handle.parentElement
    if (!target) return
    e.preventDefault()
    handle.setPointerCapture(e.pointerId)
    const start = vertical ? e.clientY : e.clientX
    const from = vertical ? target.getBoundingClientRect().height : target.getBoundingClientRect().width
    // Dragging toward the panel shrinks it: left for the asset panel, right for the inspector, down for the timeline.
    const sign = panel === 'asset' ? 1 : -1
    const [lo, hi] = LIMITS[panel]
    const max = vertical ? Math.min(hi, window.innerHeight * 0.6) : hi
    const move = (ev: PointerEvent): void =>
      setSize(panel, Math.min(max, Math.max(lo, from + sign * ((vertical ? ev.clientY : ev.clientX) - start))))
    const up = (): void => {
      handle.removeEventListener('pointermove', move)
      handle.removeEventListener('pointerup', up)
      document.body.classList.remove('resizing')
      document.body.style.cursor = ''
    }
    handle.addEventListener('pointermove', move)
    handle.addEventListener('pointerup', up)
    document.body.classList.add('resizing')
    document.body.style.cursor = vertical ? 'row-resize' : 'col-resize'
  }
  return (
    <div
      className={`splitter split-${panel}`}
      role="separator"
      aria-orientation={vertical ? 'horizontal' : 'vertical'}
      title="Drag to resize, double-click to reset"
      onPointerDown={onPointerDown}
      onDoubleClick={() => setSize(panel, null)}
    />
  )
}
