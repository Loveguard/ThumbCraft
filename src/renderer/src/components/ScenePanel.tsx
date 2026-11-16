// The "Scene changes" section of the Animate panel: the sun, the colour look, focus and an object's opacity, each
// kept as a track of keys (see shared/sceneTracks.ts) that shows on the timeline.
import { useState, type ReactNode } from 'react'
import { Focus, Plus, Trash2 } from 'lucide-react'
import { SCENE_PROPS, SCENE_PROP_IDS, fitsKind, propDef, type ScenePropId, type SceneTrack } from '@shared/sceneTracks'
import {
  canWalk,
  addSceneTrack,
  addTextEffect,
  beginEdit,
  CAMERA,
  finishEdit,
  rackFocus,
  removeSceneKey,
  removeSceneTrack,
  sceneAt,
  setSceneValue,
  useAnim
} from '../animation'
import { useStore } from '../store'
import { Group, Hint } from './controls'

const GROUPS = ['Light', 'Look', 'Focus', 'Weather', 'Object'] as const

export function ScenePanel({ tracks }: { tracks: SceneTrack[] }): ReactNode {
  const objects = useStore((s) => s.objects)
  const selectedId = useStore((s) => s.selectedId)
  const time = useAnim((a) => a.time)
  const [prop, setProp] = useState<ScenePropId>('sunAzimuth')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const sel = objects.find((o) => o.id === selectedId)
  const characters = objects.filter(canWalk)
  const needsObject = SCENE_PROPS[prop].target === 'object'
  const fits = !needsObject || (!!sel && fitsKind(prop, sel.kind))
  const nameOf = (id?: string): string => objects.find((o) => o.id === id)?.name ?? 'Removed object'

  return (
    <>
      <Group id="anim:scene" title="Scene changes">
        <div className="row">
          <select value={prop} onChange={(e) => setProp(e.target.value as ScenePropId)} aria-label="What to change">
            {GROUPS.map((g) => (
              <optgroup key={g} label={g}>
                {SCENE_PROP_IDS.filter((p) => SCENE_PROPS[p].group === g).map((p) => (
                  <option key={p} value={p}>
                    {SCENE_PROPS[p].label}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
          <button
            className="ghost"
            disabled={!fits}
            title={fits ? 'Starts a track from the value it has now' : 'Select an object that has this first'}
            onClick={() => addSceneTrack(prop, needsObject ? sel?.id : undefined)}
          >
            <Plus size={14} /> Add
          </button>
        </div>
        {tracks.map((tr) => {
          const d = propDef(tr.prop)!
          const v = sceneAt(tr, time)
          const here = tr.keys.some((k) => Math.abs(k.t - time) < 1e-3)
          return (
            <div key={tr.id} className="scene-track">
              <div className="row">
                <span className="scene-name">
                  {d.label}
                  {tr.objectId ? ` · ${nameOf(tr.objectId)}` : ''}
                </span>
                {here && (
                  <button
                    className="ghost"
                    title="Remove the key at the playhead"
                    onClick={() => removeSceneKey(tr.id, time)}
                  >
                    Key ×
                  </button>
                )}
                <button className="ghost danger" title="Remove this track" onClick={() => removeSceneTrack(tr.id)}>
                  <Trash2 size={13} />
                </button>
              </div>
              <label className="field slider">
                {d.number ? (
                  <input
                    type="number"
                    min={d.min}
                    max={d.max}
                    step={d.step}
                    value={Math.round(v)}
                    onChange={(e) => setSceneValue(tr.id, Number(e.target.value))}
                  />
                ) : (
                  <input
                    type="range"
                    min={d.min}
                    max={d.max}
                    step={d.step}
                    value={v}
                    onPointerDown={beginEdit}
                    onPointerUp={() => finishEdit(CAMERA)}
                    onChange={(e) => setSceneValue(tr.id, Number(e.target.value), true)}
                  />
                )}
                <em>{d.hold ? (v >= 0.5 ? 'On' : 'Off') : String(Math.round(v * 1000) / 1000)}</em>
              </label>
            </div>
          )
        })}
        <Hint>
          {tracks.length
            ? 'Move the playhead and drag a slider to set a key there. Keys show on the timeline.'
            : 'Change the sun, the colour look, focus or an object’s opacity over time: add one, then move the playhead and set it.'}
        </Hint>
        {sel && (sel.kind === 'text' || sel.kind === 'pixelText') && (
          <div className="row">
            <button
              className="ghost"
              onClick={() => addTextEffect('pop', sel.id)}
              title="The title pops in at the playhead"
            >
              Pop
            </button>
            <button className="ghost" onClick={() => addTextEffect('typewriter', sel.id)} title="Types itself out">
              Typewriter
            </button>
            <button className="ghost" onClick={() => addTextEffect('counter', sel.id)} title="Counts up to its number">
              Counter
            </button>
          </div>
        )}
        {characters.length > 1 && (
          <>
            <div className="row">
              <select value={from} onChange={(e) => setFrom(e.target.value)} aria-label="Focus starts on">
                <option value="">Focus from…</option>
                {characters.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
              <select value={to} onChange={(e) => setTo(e.target.value)} aria-label="Focus moves to">
                <option value="">to…</option>
                {characters.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
            <button className="ghost" disabled={!from || !to || from === to} onClick={() => rackFocus(from, to)}>
              <Focus size={14} /> Pull focus at the playhead
            </button>
          </>
        )}
      </Group>
    </>
  )
}
