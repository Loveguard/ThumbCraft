// Quick actions next to a character clicked in the scene in Animation mode: the likeliest next things it could do,
// one click each, played straight away.
import { useEffect, useRef, type ReactNode } from 'react'
import { PenLine, X } from 'lucide-react'
import { CLIPS, type ClipType } from '@shared/animation'
import { addClipAndPlay, canDo, suggestionsFor, useAnim } from '../animation'
import { useStore } from '../store'
import { BlockIcon } from './blockIcons'

const PLAYER_PICKS: ClipType[] = ['wave', 'jump', 'cheer', 'point', 'laugh', 'pose']
const MOB_PICKS: ClipType[] = ['jump', 'lunge', 'spin', 'idle', 'punch', 'wave']

export function ActionRing(): ReactNode {
  const ring = useAnim((s) => s.ring)
  const o = useStore((s) => s.objects.find((x) => x.id === ring?.id))
  const ref = useRef<HTMLDivElement>(null)
  const close = (): void => useAnim.setState({ ring: null })
  useEffect(() => {
    if (!ring) return
    const key = (e: KeyboardEvent): void => void (e.key === 'Escape' && close())
    const away = (e: PointerEvent): void => void (!ref.current?.contains(e.target as Node) && close())
    window.addEventListener('keydown', key)
    window.addEventListener('pointerdown', away, true)
    return () => {
      window.removeEventListener('keydown', key)
      window.removeEventListener('pointerdown', away, true)
    }
  }, [ring])
  if (!ring || !o) return null
  const near = suggestionsFor(o.id).slice(0, 2)
  const picks = (o.kind === 'player' ? PLAYER_PICKS : MOB_PICKS).filter((t) => canDo(o, t)).slice(0, 6 - near.length)
  const pick = (fn: () => void) => (): void => {
    close()
    fn()
  }
  return (
    <div
      className="action-ring"
      ref={ref}
      style={{ left: ring.x, top: ring.y }}
      role="menu"
      aria-label={`${o.name} could`}
    >
      <div className="action-ring-head">
        <strong>{o.name}</strong>
        <button className="icon-btn" title="Close (Esc)" onClick={close}>
          <X size={13} />
        </button>
      </div>
      {near.map((s) => (
        <button key={s.id} role="menuitem" onClick={pick(s.run)}>
          {s.label}
        </button>
      ))}
      {picks.map((t) => (
        <button key={t} role="menuitem" title={CLIPS[t].hint} onClick={pick(() => addClipAndPlay(o.id, t))}>
          <BlockIcon type={t} size={14} /> {CLIPS[t].label}
        </button>
      ))}
      <button
        role="menuitem"
        title="Drag across the ground to draw where it walks"
        onClick={pick(() => useAnim.setState({ drawing: true }))}
      >
        <PenLine size={14} /> Draw a walk
      </button>
    </div>
  )
}
