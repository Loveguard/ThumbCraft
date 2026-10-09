import { useRef, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { inShot, selection, useStore, type StickerObject } from '../store'
import { stickerSvg } from '../stickers'

type Mode = 'move' | 'scale' | 'turn'

/**
 * The thumbnail-kit stickers of the shot on screen, drawn over the 3D view (after every effect, like in the export).
 * Drag one to move it, its corner dot to resize it and its top dot to turn it.
 */
export function StickerLayer(): ReactNode {
  const stickers = useStore(
    useShallow((s) =>
      s.objects.filter((o): o is StickerObject => o.kind === 'sticker' && o.visible && inShot(o, s.activeShot))
    )
  )
  const selected = useStore(useShallow((s) => selection(s)))
  const ref = useRef<HTMLDivElement>(null)

  const start = (e: ReactPointerEvent, o: StickerObject, mode: Mode): void => {
    e.stopPropagation()
    e.preventDefault()
    const rect = ref.current?.getBoundingClientRect()
    if (!rect) return
    const s = useStore.getState()
    if (mode === 'move') {
      if (e.ctrlKey || e.metaKey || e.shiftKey) {
        s.toggleSelect(o.id)
        return
      }
      if (!selection(s).includes(o.id)) s.select(o.id)
    }
    const cx = rect.left + o.position[0] * rect.width
    const cy = rect.top + o.position[1] * rect.height
    const from = { x: e.clientX, y: e.clientY }
    const startDist = Math.max(4, Math.hypot(from.x - cx, from.y - cy))
    const startAngle = Math.atan2(from.y - cy, from.x - cx)
    const move = (ev: PointerEvent): void => {
      const { update } = useStore.getState()
      if (mode === 'move') {
        const x = o.position[0] + (ev.clientX - from.x) / rect.width
        const y = o.position[1] + (ev.clientY - from.y) / rect.height
        update(o.id, { position: [Math.min(1.1, Math.max(-0.1, x)), Math.min(1.1, Math.max(-0.1, y)), 0] })
      } else if (mode === 'scale') {
        const k = Math.hypot(ev.clientX - cx, ev.clientY - cy) / startDist
        update(o.id, { scale: Math.min(1.5, Math.max(0.03, o.scale * k)) })
      } else {
        const a = Math.atan2(ev.clientY - cy, ev.clientX - cx) - startAngle
        let r = o.rotation[2] + (a * 180) / Math.PI
        r = ((((r + 180) % 360) + 360) % 360) - 180
        // Hold Shift to snap to 15° steps.
        if (ev.shiftKey) r = Math.round(r / 15) * 15
        update(o.id, { rotation: [0, 0, Math.round(r)] })
      }
    }
    const up = (): void => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  return (
    <div className="sticker-layer" ref={ref}>
      {stickers.map((o) => {
        const active = selected.includes(o.id)
        return (
          <div
            key={o.id}
            className={`sticker ${active ? 'selected' : ''}`}
            style={{
              left: `${o.position[0] * 100}%`,
              top: `${o.position[1] * 100}%`,
              height: `${o.scale * 112}%`,
              transform: `translate(-50%, -50%) rotate(${o.rotation[2]}deg)`
            }}
            onPointerDown={(e) => start(e, o, 'move')}
          >
            <div
              className="sticker-art"
              style={{ transform: o.flip ? 'scaleX(-1)' : undefined }}
              dangerouslySetInnerHTML={{ __html: stickerSvg(o) }}
            />
            {active && (
              <>
                <i
                  className="sticker-handle scale"
                  title="Drag to resize"
                  onPointerDown={(e) => start(e, o, 'scale')}
                />
                <i
                  className="sticker-handle turn"
                  title="Drag to turn (Shift: 15° steps)"
                  onPointerDown={(e) => start(e, o, 'turn')}
                />
              </>
            )}
          </div>
        )
      })}
    </div>
  )
}
