// Plays the scene tracks (see shared/sceneTracks.ts) into the store: the sun, the look, focus and object opacity take
// the values the keys give at the playhead. What a property was before is kept and put back when its track goes.
import { countText, propDef, sampleScene, typedText, type SceneTrack } from '@shared/sceneTracks'
import { DEFAULT_RIM } from './components/rimLight'
import { useStore, type RimLight } from './store'

type Scene = ReturnType<typeof useStore.getState>

interface Rest {
  target: 'settings' | 'effects' | 'object' | 'focus'
  field: string
  id?: string
  value: unknown
}

const rest = new Map<string, Rest>()

/** What a track is called for the purpose of keeping its property's old value. */
export function driveKey(tr: Pick<SceneTrack, 'prop' | 'objectId'>): string {
  const d = propDef(tr.prop)!
  const field = d.field === 'typed' || d.field === 'count' ? 'text' : d.field === 'rimIntensity' ? 'rim' : d.field
  return d.target === 'object' ? `object:${tr.objectId}:${field}` : `${d.target}:${d.field}`
}

/** The value the property has right now (what a new track starts from). */
export function sceneValue(tr: Pick<SceneTrack, 'prop' | 'objectId'>): number {
  const d = propDef(tr.prop)!
  const s = useStore.getState()
  if (d.target === 'settings') return Number((s.settings as unknown as Record<string, unknown>)[d.field] ?? 0)
  if (d.target === 'effects') return Number((s.effects as unknown as Record<string, unknown>)[d.field] ?? 0)
  if (d.target === 'focus') return (s.effects.focusPoints[0] as Record<string, number> | undefined)?.[d.field] ?? 0.5
  const o = s.objects.find((x) => x.id === tr.objectId) as unknown as Record<string, unknown> | undefined
  if (!o) return 0
  if (d.field === 'visible') return o.visible === false ? 0 : 1
  if (d.field === 'typed' || d.field === 'reveal') return 1
  if (d.field === 'count') return Number(o.text) || 0
  // A rim light track on an object without one starts it at the usual brightness.
  if (d.field === 'rimIntensity') return (o.rim as RimLight | null | undefined)?.intensity ?? DEFAULT_RIM.intensity
  return Number(o[d.field] ?? 1)
}

type Write = (patch: Partial<Scene>) => void

/** Sets every tracked property to its value at `t`. */
export function driveScene(tracks: SceneTrack[], t: number, write: Write): void {
  if (!tracks.length) return
  const s = useStore.getState()
  let settings = s.settings
  let effects = s.effects
  let objects = s.objects
  for (const tr of tracks) {
    const v = sampleScene(tr, t)
    const d = propDef(tr.prop)
    if (v === null || !d) continue
    const key = driveKey(tr)
    if (d.target === 'object') {
      const i = objects.findIndex((o) => o.id === tr.objectId)
      if (i < 0) continue
      const o = objects[i] as unknown as Record<string, unknown>
      if (d.kinds && !d.kinds.includes(o.kind as string)) continue
      // Building up is drawn by clipping the model, not by changing the object (see animation.ts).
      if (d.field === 'reveal') continue
      const text = d.field === 'typed' || d.field === 'count'
      const rim = d.field === 'rimIntensity'
      const field = text ? 'text' : rim ? 'rim' : d.field
      if (!rest.has(key)) rest.set(key, { target: 'object', field, id: tr.objectId, value: o[field] })
      const full = String(rest.get(key)!.value ?? '')
      if (rim) {
        const was = (o.rim as RimLight | null | undefined) ?? (rest.get(key)!.value as RimLight | null) ?? DEFAULT_RIM
        if (was.intensity === v && o.rim) continue
        objects = objects.map((x, j) => (j === i ? ({ ...x, rim: { ...was, intensity: v } } as typeof x) : x))
        continue
      }
      const next =
        d.field === 'visible'
          ? v >= 0.5
          : d.field === 'typed'
            ? typedText(full, v)
            : d.field === 'count'
              ? countText(v)
              : v
      if (o[field] === next) continue
      objects = objects.map((x, j) => (j === i ? ({ ...x, [field]: next } as typeof x) : x))
      continue
    }
    if (d.target === 'settings') {
      if (!rest.has(key)) rest.set(key, { target: 'settings', field: d.field, value: (settings as never)[d.field] })
      if ((settings as unknown as Record<string, unknown>)[d.field] !== v) settings = { ...settings, [d.field]: v }
      continue
    }
    if (!rest.has(key)) {
      const value = d.target === 'focus' ? structuredClone(effects.focusPoints) : (effects as never)[d.field]
      rest.set(key, { target: d.target, field: d.field, value })
    }
    if (d.enable && !rest.has(`effects:${d.enable}`))
      rest.set(`effects:${d.enable}`, { target: 'effects', field: d.enable, value: (effects as never)[d.enable] })
    const patch: Record<string, unknown> = {}
    if (d.enable && (effects as never)[d.enable] !== true) patch[d.enable] = true
    if (d.target === 'focus') {
      const p = effects.focusPoints[0] ?? { x: 0.5, y: 0.55 }
      if ((p as unknown as Record<string, number>)[d.field] !== v)
        patch.focusPoints = [{ ...p, [d.field]: v }, ...effects.focusPoints.slice(1)]
    } else if ((effects as unknown as Record<string, unknown>)[d.field] !== v) patch[d.field] = v
    if (Object.keys(patch).length) effects = { ...effects, ...patch }
  }
  const out: Partial<Scene> = {}
  if (settings !== s.settings) out.settings = settings
  if (effects !== s.effects) out.effects = effects
  if (objects !== s.objects) out.objects = objects
  if (Object.keys(out).length) write(out)
}

/** Puts back every property that isn't in `keep` (all of them when it is empty). */
export function releaseScene(keep: Set<string>, write: Write): void {
  if (!rest.size) return
  const s = useStore.getState()
  let settings = s.settings
  let effects = s.effects
  let objects = s.objects
  for (const [key, r] of [...rest]) {
    if (keep.has(key)) continue
    rest.delete(key)
    if (r.target === 'settings') settings = { ...settings, [r.field]: r.value }
    else if (r.target === 'object') {
      objects = objects.map((o) => (o.id === r.id ? ({ ...o, [r.field]: r.value } as typeof o) : o))
    } else if (r.target === 'focus') effects = { ...effects, focusPoints: r.value as typeof effects.focusPoints }
    else effects = { ...effects, [r.field]: r.value }
  }
  const out: Partial<Scene> = {}
  if (settings !== s.settings) out.settings = settings
  if (effects !== s.effects) out.effects = effects
  if (objects !== s.objects) out.objects = objects
  if (Object.keys(out).length) write(out)
}

export const sceneDriven = (): boolean => rest.size > 0
