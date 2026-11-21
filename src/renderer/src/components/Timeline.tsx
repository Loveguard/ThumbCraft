// The Animation mode's timeline, under the viewport: play, scrub, and a row for every character. Blocks (walk, jump,
// point...) are dropped on a row, dragged along it and stretched by their edges; other animated objects show keys.
import {
  useEffect,
  useRef,
  useState,
  type DragEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode
} from 'react'
import { Pause, Play, Repeat, SkipBack } from 'lucide-react'
import { snapToBeats } from '@shared/audio'
import { SCENE_PROPS, type SceneTrack } from '@shared/sceneTracks'
import { CAMS, type CamClip, type CamType } from '@shared/camera'
import {
  animationLength,
  canLayer,
  laneOf,
  CLIPS,
  GAITS,
  keyAt,
  NO_ANIMATION,
  placeClip,
  type Clip,
  type ClipType,
  type Span
} from '@shared/animation'
import {
  addCamClip,
  addClip,
  beginEdit,
  setAnimationLive,
  CAMERA,
  canWalk,
  copyClip,
  cutClip,
  deleteClip,
  duplicateClip,
  finishEdit,
  hasClipboard,
  pasteClip,
  moveClip,
  moveKey,
  moveSceneKey,
  pause,
  play,
  resizeClip,
  seek,
  selectClip,
  setAnimation,
  useAnim
} from '../animation'
import { useStore } from '../store'

const SOUND = '__sound__'
const SCENE = '__scene__:'

/** A waveform as polygon points: the peaks mirrored about the middle, across `length` seconds (in hundredths). */
function wave(peaks: number[], length: number): string {
  const n = peaks.length
  const x = (i: number): number => ((i + 0.5) / n) * length * 100
  const up = peaks.map((p, i) => `${x(i).toFixed(1)},${(1 - p).toFixed(2)}`)
  const down = peaks.map((p, i) => `${x(i).toFixed(1)},${(1 + p).toFixed(2)}`).reverse()
  return [...up, ...down].join(' ')
}

/** Seconds as "1.25 s". */
const secs = (t: number): string => `${t.toFixed(2)} s`

export function Timeline(): ReactNode {
  const animation = useStore((s) => s.settings.animation) ?? NO_ANIMATION
  const objects = useStore((s) => s.objects)
  const selectedId = useStore((s) => s.selectedId)
  const time = useAnim((s) => s.time)
  const playing = useAnim((s) => s.playing)
  const selected = useAnim((s) => s.selectedClip)
  const note = useAnim((s) => s.note)
  const gaits = useAnim((s) => s.gaits)
  const length = animationLength(animation)
  // Room after the last key to drop more blocks into; it only changes by whole seconds, so nothing jumps while dragging.
  const span = Math.max(8, Math.ceil(length + 2))
  const lanes = useRef<HTMLDivElement>(null)
  const cameraClips = animation.camera?.clips ?? []
  const [ghost, setGhost] = useState<{ objectId: string; start: number; duration: number } | null>(null)

  // The right-click menu: on a block (copy, cut, duplicate, delete) or on an empty spot of a row (paste there).
  const [menu, setMenu] = useState<{
    x: number
    y: number
    objectId: string
    clip?: Clip
    at: number
    upper?: boolean
  } | null>(null)
  useEffect(() => {
    if (!menu) return
    const close = (): void => setMenu(null)
    const key = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') close()
    }
    window.addEventListener('pointerdown', close)
    window.addEventListener('keydown', key)
    window.addEventListener('blur', close)
    return () => {
      window.removeEventListener('pointerdown', close)
      window.removeEventListener('keydown', key)
      window.removeEventListener('blur', close)
    }
  }, [menu])

  // A walk that has to be fast shows as what it became.
  const labelOf = (c: Clip): string => {
    const g = gaits[c.id]
    return c.type === 'walk' && c.auto !== false && g && g !== 'walk' ? `Walk → ${GAITS[g].label}` : CLIPS[c.type].label
  }

  // Each player has a second row under its own for upper-body blocks (a wave while walking).
  type Row = { id: string; obj: string; name: string; upper?: boolean; scene?: SceneTrack }
  const audio = animation.audio
  const rows: Row[] = [
    { id: CAMERA, obj: CAMERA, name: 'Camera' },
    ...(audio ? [{ id: SOUND, obj: SOUND, name: 'Sound' }] : []),
    ...objects
      .filter(canWalk)
      .flatMap((o): Row[] => [
        { id: o.id, obj: o.id, name: o.name },
        ...(o.kind === 'player' ? [{ id: `${o.id}:upper`, obj: o.id, name: 'Arms and head', upper: true }] : [])
      ]),
    ...animation.tracks
      .filter((t) => !objects.some((o) => o.id === t.objectId && canWalk(o)))
      .map((t) => ({
        id: t.objectId,
        obj: t.objectId,
        name: objects.find((o) => o.id === t.objectId)?.name ?? 'Removed object'
      })),
    ...(animation.scene ?? []).map((tr) => ({
      id: SCENE + tr.id,
      obj: SCENE + tr.id,
      name: `${SCENE_PROPS[tr.prop].label}${tr.objectId ? ` · ${objects.find((o) => o.id === tr.objectId)?.name ?? ''}` : ''}`,
      upper: true,
      scene: tr
    }))
  ]

  // With "snap to the beat" on, edges of blocks that come near a beat go to it.
  const beat = (t: number): number =>
    audio?.snap && audio.beats.length ? snapToBeats(t - audio.offset, audio.beats) + audio.offset : t
  const beatSpan = (start: number, duration: number): number => {
    const a = beat(start)
    const b = beat(start + duration) - duration
    return Math.abs(a - start) <= Math.abs(b - start) ? a : b
  }

  const dragSound = (e: ReactPointerEvent): void => {
    if (e.button !== 0 || !audio) return
    e.stopPropagation()
    const el = e.currentTarget as HTMLElement
    el.setPointerCapture(e.pointerId)
    if (playing) pause()
    const x0 = e.clientX
    const was = audio.offset
    let moved = false
    const move = (ev: PointerEvent): void => {
      if (!moved && Math.abs(ev.clientX - x0) < 3) return
      if (!moved) beginEdit()
      moved = true
      const dt = ((ev.clientX - x0) / lanes.current!.getBoundingClientRect().width) * span
      setAnimationLive({ audio: { ...audio, offset: Math.round((was + dt) * 100) / 100 } })
    }
    const up = (): void => {
      el.removeEventListener('pointermove', move)
      el.removeEventListener('pointerup', up)
    }
    el.addEventListener('pointermove', move)
    el.addEventListener('pointerup', up)
  }

  const timeAt = (clientX: number): number => {
    const r = lanes.current!.getBoundingClientRect()
    return ((clientX - r.left) / r.width) * span
  }

  const scrub = (e: ReactPointerEvent): void => {
    if (e.button !== 0) return
    const el = e.currentTarget as HTMLElement
    el.setPointerCapture(e.pointerId)
    if (playing) pause()
    seek(timeAt(e.clientX))
    const move = (ev: PointerEvent): void => seek(timeAt(ev.clientX))
    const up = (): void => {
      el.removeEventListener('pointermove', move)
      el.removeEventListener('pointerup', up)
    }
    el.addEventListener('pointermove', move)
    el.addEventListener('pointerup', up)
  }

  const dragKey = (e: ReactPointerEvent, id: string, index: number, t: number): void => {
    if (e.button !== 0) return
    e.stopPropagation()
    const el = e.currentTarget as HTMLElement
    el.setPointerCapture(e.pointerId)
    if (playing) pause()
    useStore.getState().select(id)
    seek(t)
    const x0 = e.clientX
    let moved = false
    const move = (ev: PointerEvent): void => {
      if (!moved && Math.abs(ev.clientX - x0) < 3) return
      const r = lanes.current!.getBoundingClientRect()
      const to = t + ((ev.clientX - x0) / r.width) * span
      moveKey(id, index, to, moved)
      moved = true
      seek(Math.max(0, to))
    }
    const up = (): void => {
      el.removeEventListener('pointermove', move)
      el.removeEventListener('pointerup', up)
    }
    el.addEventListener('pointermove', move)
    el.addEventListener('pointerup', up)
  }

  const dragSceneKey = (e: ReactPointerEvent, id: string, t: number): void => {
    if (e.button !== 0) return
    e.stopPropagation()
    const el = e.currentTarget as HTMLElement
    el.setPointerCapture(e.pointerId)
    if (playing) pause()
    seek(t)
    const x0 = e.clientX
    let at = t
    let moved = false
    const move = (ev: PointerEvent): void => {
      if (!moved && Math.abs(ev.clientX - x0) < 3) return
      if (!moved) beginEdit()
      moved = true
      const to = Math.max(0, t + ((ev.clientX - x0) / lanes.current!.getBoundingClientRect().width) * span)
      moveSceneKey(id, at, to, true)
      at = Math.round(to * 1000) / 1000
      seek(at)
    }
    const up = (): void => {
      el.removeEventListener('pointermove', move)
      el.removeEventListener('pointerup', up)
      if (moved) finishEdit(CAMERA)
    }
    el.addEventListener('pointermove', move)
    el.addEventListener('pointerup', up)
  }

  const dragClip = (e: ReactPointerEvent, objectId: string, clip: Span, mode: 'move' | 'start' | 'end'): void => {
    if (e.button !== 0) return
    e.stopPropagation()
    const el = e.currentTarget as HTMLElement
    el.setPointerCapture(e.pointerId)
    if (playing) pause()
    selectClip({ objectId, clipId: clip.id })
    const x0 = e.clientX
    let moved = false
    const move = (ev: PointerEvent): void => {
      if (!moved && Math.abs(ev.clientX - x0) < 3) return
      if (!moved) beginEdit()
      const dt = ((ev.clientX - x0) / lanes.current!.getBoundingClientRect().width) * span
      if (mode === 'move') moveClip(objectId, clip.id, beatSpan(clip.start + dt, clip.duration), true)
      else if (mode === 'start') resizeClip(objectId, clip.id, 'start', beat(clip.start + dt), true)
      else resizeClip(objectId, clip.id, 'end', beat(clip.start + clip.duration + dt), true)
      moved = true
    }
    const up = (): void => {
      el.removeEventListener('pointermove', move)
      el.removeEventListener('pointerup', up)
      if (moved) finishEdit(objectId)
    }
    el.addEventListener('pointermove', move)
    el.addEventListener('pointerup', up)
  }

  const spotFor = (row: Row, e: DragEvent): { start: number; duration: number } | null => {
    const type = (useAnim.getState().dragType ?? e.dataTransfer.getData('text/plain')) as ClipType | CamType
    const camera = row.obj === CAMERA
    // Camera blocks go on the camera's row and character blocks on a character's.
    if (camera ? !(type in CAMS) : !(type in CLIPS)) return null
    if (row.upper && !canLayer(type as ClipType)) return null
    const clips = camera
      ? cameraClips
      : (animation.tracks.find((t) => t.objectId === row.obj)?.clips ?? []).filter(
          (c) => laneOf(c) === (row.upper ? 'upper' : 'base')
        )
    const duration = camera ? CAMS[type as CamType].duration : CLIPS[type as ClipType].duration
    return placeClip(clips, { start: beat(timeAt(e.clientX) - duration / 2), duration })
  }

  const ticks: number[] = []
  const step = span > 20 ? 5 : span > 8 ? 2 : span > 3 ? 1 : 0.5
  for (let t = 0; t <= span; t += step) ticks.push(t)
  const pct = (t: number): string => `${(t / span) * 100}%`

  return (
    <div className="timeline">
      <div className="tl-bar">
        <button className="icon-btn" title="To the start" onClick={() => seek(0)}>
          <SkipBack size={15} />
        </button>
        <button className="icon-btn tl-play" title="Play or pause (Space)" onClick={() => (playing ? pause() : play())}>
          {playing ? <Pause size={16} /> : <Play size={16} />}
        </button>
        <span className="tl-time">
          {secs(time)} <em>/ {secs(length)}</em>
        </span>
        {note && <span className="tl-note">{note}</span>}
        <span className="tl-spacer" />
        <button
          className={`icon-btn ${animation.loop ? 'active' : ''}`}
          title={animation.loop ? 'Looping' : 'Plays once'}
          aria-pressed={animation.loop}
          onClick={() => setAnimation({ loop: !animation.loop })}
        >
          <Repeat size={15} />
        </button>
      </div>
      <div className="tl-body">
        <div className="tl-names">
          <div className="tl-name tl-ruler-name" />
          {rows.map((r) => (
            <button
              key={r.id}
              className={`tl-name ${r.upper ? 'sub' : ''} ${r.obj === selectedId ? 'active' : ''}`}
              onClick={() => !r.scene && r.obj !== CAMERA && r.obj !== SOUND && useStore.getState().select(r.obj)}
            >
              {r.name}
            </button>
          ))}
        </div>
        <div className="tl-lanes" ref={lanes} onPointerDown={scrub}>
          <div className="tl-ruler">
            {ticks.map((t) => (
              <span key={t} style={{ left: pct(t) }}>
                {Number.isInteger(t) ? `${t}s` : ''}
              </span>
            ))}
          </div>
          {rows.map((r) => {
            if (r.obj === SOUND && audio)
              return (
                <div key={r.id} className="tl-lane sound-lane">
                  <div
                    className="tl-sound"
                    style={{ left: pct(audio.offset), width: pct(audio.length) }}
                    title={`${audio.name}${audio.bpm ? ` · about ${Math.round(audio.bpm)} beats a minute` : ''}. Drag to move it.`}
                    onPointerDown={dragSound}
                  >
                    <svg viewBox={`0 0 ${Math.max(1, audio.length * 100)} 2`} preserveAspectRatio="none">
                      <polygon points={wave(audio.peaks, audio.length)} />
                      {audio.beats.map((b) => (
                        <line key={b} x1={b * 100} x2={b * 100} y1={0} y2={2} vectorEffect="non-scaling-stroke" />
                      ))}
                    </svg>
                  </div>
                </div>
              )
            if (r.scene) {
              const st = r.scene
              return (
                <div key={r.id} className="tl-lane sub scene-lane">
                  {st.keys.map((k) => (
                    <i
                      key={k.t}
                      className={`tl-key ${Math.abs(k.t - time) < 1e-3 ? 'current' : ''}`}
                      style={{ left: pct(k.t) }}
                      title={`${secs(k.t)} · ${Math.round(k.v * 1000) / 1000}`}
                      onPointerDown={(e) => dragSceneKey(e, st.id, k.t)}
                    />
                  ))}
                </div>
              )
            }
            const tr = animation.tracks.find((t) => t.objectId === r.obj)
            const rowClips = tr?.clips?.filter((c) => laneOf(c) === (r.upper ? 'upper' : 'base'))
            const here = tr ? keyAt(tr.keys, time) : -1
            return (
              <div
                key={r.id}
                className={`tl-lane ${r.upper ? 'sub' : ''} ${r.obj === selectedId ? 'active' : ''}`}
                onContextMenu={(e) => {
                  e.preventDefault()
                  if (r.obj !== CAMERA && !canWalk(objects.find((o) => o.id === r.obj))) return
                  if (r.obj !== CAMERA) useStore.getState().select(r.obj)
                  setMenu({ x: e.clientX, y: e.clientY, objectId: r.obj, at: timeAt(e.clientX), upper: r.upper })
                }}
                onDragOver={(e) => {
                  const spot = r.obj === CAMERA || canWalk(objects.find((o) => o.id === r.obj)) ? spotFor(r, e) : null
                  if (!spot) return
                  e.preventDefault()
                  setGhost({ objectId: r.id, ...spot })
                }}
                onDragLeave={() => setGhost(null)}
                onDrop={(e) => {
                  e.preventDefault()
                  const spot = spotFor(r, e)
                  const type = (useAnim.getState().dragType ?? e.dataTransfer.getData('text/plain')) as
                    ClipType | CamType
                  setGhost(null)
                  useAnim.setState({ dragType: null })
                  if (!spot) return
                  if (r.obj === CAMERA && type in CAMS) addCamClip(type as CamType, spot.start)
                  else if (r.obj !== CAMERA && type in CLIPS)
                    addClip(r.obj, type as ClipType, spot.start, r.upper ? 'upper' : undefined)
                }}
              >
                {ghost?.objectId === r.id && (
                  <i className="tl-clip tl-ghost" style={{ left: pct(ghost.start), width: pct(ghost.duration) }} />
                )}
                {r.obj === CAMERA &&
                  cameraClips.map((c: CamClip) => (
                    <div
                      key={c.id}
                      className={`tl-clip cam-clip ${selected?.clipId === c.id ? 'selected' : ''}`}
                      style={{ left: pct(c.start), width: pct(c.duration) }}
                      title={`${CAMS[c.type].label} · ${c.duration.toFixed(1)} s`}
                      onPointerDown={(e) => dragClip(e, CAMERA, c, 'move')}
                      onContextMenu={(e) => {
                        e.preventDefault()
                        e.stopPropagation()
                        selectClip({ objectId: CAMERA, clipId: c.id })
                        setMenu({
                          x: e.clientX,
                          y: e.clientY,
                          objectId: CAMERA,
                          clip: c as unknown as Clip,
                          at: timeAt(e.clientX)
                        })
                      }}
                    >
                      <b className="tl-edge start" onPointerDown={(e) => dragClip(e, CAMERA, c, 'start')} />
                      <span>{CAMS[c.type].label}</span>
                      <b className="tl-edge end" onPointerDown={(e) => dragClip(e, CAMERA, c, 'end')} />
                    </div>
                  ))}
                {rowClips?.map((c) => (
                  <div
                    key={c.id}
                    className={`tl-clip clip-${c.type} ${selected?.clipId === c.id ? 'selected' : ''}`}
                    style={{ left: pct(c.start), width: pct(c.duration) }}
                    title={`${CLIPS[c.type].label} · ${c.duration.toFixed(1)} s`}
                    onPointerDown={(e) => dragClip(e, r.obj, c, 'move')}
                    onContextMenu={(e) => {
                      e.preventDefault()
                      e.stopPropagation()
                      selectClip({ objectId: r.obj, clipId: c.id })
                      setMenu({
                        x: e.clientX,
                        y: e.clientY,
                        objectId: r.obj,
                        clip: c,
                        at: timeAt(e.clientX),
                        upper: r.upper
                      })
                    }}
                  >
                    <b className="tl-edge start" onPointerDown={(e) => dragClip(e, r.obj, c, 'start')} />
                    <span>{labelOf(c)}</span>
                    <b className="tl-edge end" onPointerDown={(e) => dragClip(e, r.obj, c, 'end')} />
                  </div>
                ))}
                {tr &&
                  !r.upper &&
                  !tr.clips?.length &&
                  tr.keys.map((k, i) => (
                    <button
                      key={i}
                      className={`tl-key ${i === here && r.id === selectedId ? 'current' : ''}`}
                      style={{ left: pct(k.t) }}
                      title={secs(k.t)}
                      onPointerDown={(e) => dragKey(e, r.obj, i, k.t)}
                    />
                  ))}
              </div>
            )
          })}
          {!rows.length && <p className="tl-empty">Add a player or a mob, then drag blocks onto its row.</p>}
          <div className="tl-playhead" style={{ left: pct(time) }} />
        </div>
      </div>
      {menu && (
        <div
          className="tl-menu"
          style={{
            left: Math.min(menu.x, window.innerWidth - 210),
            top: Math.min(menu.y, window.innerHeight - (menu.clip ? 170 : 50))
          }}
          onPointerDown={(e) => e.stopPropagation()}
          onContextMenu={(e) => e.preventDefault()}
        >
          {menu.clip ? (
            <>
              <button onClick={() => (copyClip(), setMenu(null))}>
                Copy <kbd>Ctrl+C</kbd>
              </button>
              <button onClick={() => (cutClip(), setMenu(null))}>
                Cut <kbd>Ctrl+X</kbd>
              </button>
              <button onClick={() => (duplicateClip(), setMenu(null))}>
                Duplicate <kbd>Ctrl+D</kbd>
              </button>
              <button
                disabled={!hasClipboard()}
                onClick={() => (pasteClip(menu.objectId, menu.at, menu.upper ? 'upper' : 'base'), setMenu(null))}
              >
                Paste <kbd>Ctrl+V</kbd>
              </button>
              <hr />
              <button className="danger" onClick={() => (deleteClip(menu.objectId, menu.clip!.id), setMenu(null))}>
                Delete <kbd>Del</kbd>
              </button>
            </>
          ) : (
            <button
              disabled={!hasClipboard()}
              onClick={() => (pasteClip(menu.objectId, menu.at, menu.upper ? 'upper' : 'base'), setMenu(null))}
            >
              Paste here <kbd>Ctrl+V</kbd>
            </button>
          )}
        </div>
      )}
    </div>
  )
}
