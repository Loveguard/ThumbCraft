// The Curves section of the Animate panel: any one number of the selected character's animation (where it is, how it
// is turned, a joint's angle, a mob part's angle) drawn over time. On a hand-keyed track the keys can be dragged: up
// and down changes the value, sideways changes when it happens. Tracks made from blocks are shown but read-only.
import { useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react'
import { channelsOf, channelValue } from '@shared/curves'
import { animationLength, sampleTrack } from '@shared/animation'
import { beginEdit, CAMERA, finishEdit, moveKey, seek, setKeyChannel, stateAt, useAnim } from '../animation'
import { useStore } from '../store'
import { Group, Hint } from './controls'

const W = 300
const H = 130
const PAD = 14

export function CurvesPanel(): ReactNode {
  const selectedId = useStore((s) => s.selectedId)
  const animation = useStore((s) => s.settings.animation)
  const objects = useStore((s) => s.objects)
  const time = useAnim((a) => a.time)
  const [channel, setChannel] = useState('pos.1')
  const svg = useRef<SVGSVGElement>(null)
  const track = animation?.tracks.find((t) => t.objectId === selectedId)
  const o = objects.find((x) => x.id === selectedId)
  const channels = useMemo(() => (track ? channelsOf(track) : []), [track])
  const id = channels.some((c) => c.id === channel) ? channel : (channels[0]?.id ?? 'pos.1')
  const byBlocks = !!track?.clips?.length
  const len = animationLength(animation)

  const curve = useMemo(() => {
    if (!track || track.keys.length < 2) return null
    const samples: [number, number][] = []
    const n = Math.min(600, Math.max(20, Math.round(len * 30)))
    for (let i = 0; i <= n; i++) {
      const t = (i / n) * len
      const st = stateAt(track, t, o) ?? sampleTrack(track, t)
      const v = st && channelValue({ position: st.position, rotation: st.rotation, pose: st.pose, parts: st.parts }, id)
      if (v !== null && v !== undefined) samples.push([t, v])
    }
    const vals = samples.map((s) => s[1]).concat(track.keys.map((k) => channelValue(k, id) ?? 0))
    let lo = Math.min(...vals)
    let hi = Math.max(...vals)
    if (hi - lo < 1e-3) {
      lo -= 1
      hi += 1
    }
    const pad = (hi - lo) * 0.1
    return { samples, lo: lo - pad, hi: hi + pad }
  }, [track, o, id, len])

  if (!track || !curve) return null
  const x = (t: number): number => PAD + (t / len) * (W - 2 * PAD)
  const y = (v: number): number => H - PAD - ((v - curve.lo) / (curve.hi - curve.lo)) * (H - 2 * PAD)
  const unit = channels.find((c) => c.id === id)?.unit === 'blocks' ? '' : '°'

  const drag = (e: ReactPointerEvent, index: number): void => {
    if (byBlocks || e.button !== 0) return
    e.stopPropagation()
    const el = e.currentTarget as SVGElement
    el.setPointerCapture(e.pointerId)
    const box = svg.current!.getBoundingClientRect()
    const k = track.keys[index]
    seek(k.t)
    let began = false
    const move = (ev: PointerEvent): void => {
      if (!began) {
        if (Math.hypot(ev.clientX - e.clientX, ev.clientY - e.clientY) < 3) return
        beginEdit()
        began = true
      }
      const py = ((ev.clientY - box.top) / box.height) * H
      const v = curve.lo + ((H - PAD - py) / (H - 2 * PAD)) * (curve.hi - curve.lo)
      const t = (((ev.clientX - box.left) / box.width) * W - PAD) / (W - 2 * PAD)
      setKeyChannel(selectedId!, index, id, v, true)
      if (Math.abs(t * len - k.t) > 1 / 30) moveKey(selectedId!, index, t * len, true)
    }
    const up = (): void => {
      el.removeEventListener('pointermove', move)
      el.removeEventListener('pointerup', up)
      if (began) finishEdit(CAMERA)
    }
    el.addEventListener('pointermove', move)
    el.addEventListener('pointerup', up)
  }

  const groups = ['Move', 'Turn', 'Joint', 'Part'] as const
  return (
    <>
      <Group id="anim:curves" title="Curves">
        <label className="field">
          <span>Show</span>
          <select value={id} onChange={(e) => setChannel(e.target.value)}>
            {groups.map(
              (g) =>
                channels.some((c) => c.group === g) && (
                  <optgroup key={g} label={g === 'Joint' ? 'Joints' : g === 'Part' ? 'Mob parts' : g}>
                    {channels
                      .filter((c) => c.group === g)
                      .map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.label}
                        </option>
                      ))}
                  </optgroup>
                )
            )}
          </select>
        </label>
        <svg
          ref={svg}
          className="curves"
          viewBox={`0 0 ${W} ${H}`}
          onPointerDown={(e) => {
            const box = e.currentTarget.getBoundingClientRect()
            seek(Math.max(0, ((((e.clientX - box.left) / box.width) * W - PAD) / (W - 2 * PAD)) * len))
          }}
        >
          {curve.lo <= 0 && curve.hi >= 0 && <line x1={PAD} x2={W - PAD} y1={y(0)} y2={y(0)} className="zero" />}
          <polyline className="line" points={curve.samples.map(([t, v]) => `${x(t)},${y(v)}`).join(' ')} />
          <line className="playhead" x1={x(time)} x2={x(time)} y1={PAD / 2} y2={H - PAD / 2} />
          {!byBlocks &&
            track.keys.map((k, i) => (
              <circle
                key={i}
                className="key"
                cx={x(k.t)}
                cy={y(channelValue(k, id) ?? 0)}
                r={4.5}
                onPointerDown={(e) => drag(e, i)}
              />
            ))}
          <text x={PAD} y={10}>
            {Math.round(curve.hi * 100) / 100}
            {unit}
          </text>
          <text x={PAD} y={H - 2}>
            {Math.round(curve.lo * 100) / 100}
            {unit}
          </text>
        </svg>
        <Hint>
          {byBlocks
            ? 'This character moves by blocks, so its curves are read-only. Bake to keys (under Share and move) to edit them by hand.'
            : 'Drag a dot up or down to change the value, or sideways to change when it happens.'}
        </Hint>
      </Group>
    </>
  )
}
