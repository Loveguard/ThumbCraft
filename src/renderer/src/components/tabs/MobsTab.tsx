import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import {
  ENTITY_CATEGORIES,
  entityCategory,
  HIDDEN_LAYERS,
  layerModel,
  layerName,
  textureCandidates,
  type EntityCategory,
  type MobModels
} from '@shared/minecraft/entityModels'
import { mobModels } from '../../minecraft/mobs'
import { mobThumbnail } from '../../minecraft/thumbnails'
import { placeNew } from '../../placement'
import { newId, useStore } from '../../store'
import { errorText } from '../../errors'
import { ColorSection, Hint } from '../controls'

/** Stand-in key for the giant when the game has no layer of its own for it. */
const GIANT = 'minecraft:giant#main'

const pretty = (key: string): string => {
  const name = layerModel(key)
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase())
  const layer = layerName(key)
  return layer === 'main' ? name : `${name} (${layer.replace(/_/g, ' ')})`
}

/** The mob's own model, rendered isometrically once it scrolls into view. */
function MobIcon({ models, layerKey }: { models: MobModels; layerKey: string }): ReactNode {
  const ref = useRef<HTMLSpanElement>(null)
  const [src, setSrc] = useState<string | null>(null)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    let alive = true
    const io = new IntersectionObserver(([e]) => {
      if (!e.isIntersecting) return
      io.disconnect()
      const texture = textureCandidates(layerKey, models.layers[layerKey], models.textureSizes)[0]
      if (texture) void mobThumbnail(models, layerKey, texture).then((u) => alive && setSrc(u))
    })
    io.observe(el)
    return () => {
      alive = false
      io.disconnect()
    }
  }, [models, layerKey])
  return (
    <span ref={ref} className="asset-thumb">
      {src && <img src={src} alt="" />}
    </span>
  )
}

/** Log text with the user's name taken out of home-folder paths, since these get pasted into public bug reports. */
const withoutUserName = (text: string): string =>
  text
    .replace(/([A-Za-z]:[\\/]Users[\\/])[^\\/\r\n]+/gi, '$1<user>')
    .replace(/(\/(?:home|Users)\/)[^/\r\n]+/g, '$1<user>')

/** Each entity category's accent (matching the colour-coded sections of the other tabs). */
const CATEGORY_COLOURS: Record<EntityCategory, string> = {
  mobs: '#4ade80',
  bosses: '#f87171',
  blocks: '#fbbf24',
  vehicles: '#60a5fa',
  gear: '#b48cff',
  effects: '#f472b6'
}

function MobGrid({
  keys,
  models,
  onAdd
}: {
  keys: string[]
  models: MobModels
  onAdd: (key: string) => void
}): ReactNode {
  return (
    <div className="card-grid">
      {keys.map((k) => (
        <button key={k} className="asset-card" onClick={() => onAdd(k)} title={pretty(k)} aria-label={pretty(k)}>
          <MobIcon models={models} layerKey={k === GIANT ? 'minecraft:zombie#main' : k} />
          <span className="asset-name">{pretty(k)}</span>
        </button>
      ))}
    </div>
  )
}

export function MobsTab(): ReactNode {
  const [models, setModels] = useState<MobModels | null>(null)
  const [error, setError] = useState('')
  const [log, setLog] = useState<string[]>([])
  const [filter, setFilter] = useState('')
  const [allLayers, setAllLayers] = useState(false)

  useEffect(() => {
    const off = window.blockframe.onMobProgress((line) => setLog((l) => [...l.slice(-20), line.trim()].filter(Boolean)))
    mobModels().then(setModels, (e: Error) => setError(e.message))
    return off
  }, [])

  /** The layers shown: each model's main layer (or its first, if it has none), minus part-only pieces. */
  const shownLayers = useMemo(() => {
    if (!models) return []
    const all = Object.keys(models.layers).filter((k) => !HIDDEN_LAYERS.test(layerModel(k)))
    const hasMain = new Set(all.filter((k) => layerName(k) === 'main').map(layerModel))
    const firstOf = new Map<string, string>()
    for (const k of all) if (!firstOf.has(layerModel(k))) firstOf.set(layerModel(k), k)
    const out = all.filter(
      (k) => allLayers || layerName(k) === 'main' || (!hasMain.has(layerModel(k)) && firstOf.get(layerModel(k)) === k)
    )
    // The giant is the zombie model at six times the size; offer it even when the game has no layer of its own.
    if (!models.layers['minecraft:giant#main'] && models.layers['minecraft:zombie#main']) out.push(GIANT)
    return out
  }, [models, allLayers])

  /** Search matches across every category (empty when not searching). */
  const matches = useMemo(() => {
    const f = filter.trim().toLowerCase()
    if (!f) return []
    return shownLayers
      .filter((k) => pretty(k).toLowerCase().includes(f) || k.includes(f.replace(/\s+/g, '_')))
      .sort((a, b) => pretty(a).localeCompare(pretty(b)))
  }, [shownLayers, filter])
  /** Each category's entities, alphabetically. */
  const byCategory = useMemo(() => {
    const c = new Map<EntityCategory, string[]>()
    for (const k of [...shownLayers].sort((a, b) => pretty(a).localeCompare(pretty(b)))) {
      const cat = entityCategory(k)
      c.set(cat, [...(c.get(cat) ?? []), k])
    }
    return c
  }, [shownLayers])

  const add = (shown: string): void => {
    const key = shown === GIANT ? 'minecraft:zombie#main' : shown
    const layer = models!.layers[key]
    const texture = textureCandidates(key, layer, models!.textureSizes)[0]
    if (!texture) {
      useStore.getState().setStatus(`No entity texture in this jar matches ${pretty(key)}'s UV size`)
      return
    }
    useStore.getState().add({
      id: newId('obj'),
      kind: 'mob',
      name: pretty(shown),
      layer: key,
      texture,
      partRotations: {},
      visible: true,
      ...placeNew('ground', shown === GIANT ? 4 : 1),
      scale: shown === GIANT ? 6 : 1
    })
  }

  if (error) {
    const message = errorText(error)
    const [headline, ...details] = message.split('\n')
    return (
      <div className="tab-body">
        <div className="callout error">
          <strong>Couldn't read the mob models</strong>
          <span>{headline}</span>
        </div>
        {(details.length > 0 || log.length > 0) && (
          <div className="log">{[...details, '', ...log.slice(-12)].join('\n')}</div>
        )}
        <div className="row">
          <button
            onClick={() => {
              setError('')
              setLog([])
              mobModels().then(setModels, (e: Error) => setError(e.message))
            }}
          >
            Try again
          </button>
          <button onClick={() => void navigator.clipboard.writeText(withoutUserName([message, '', ...log].join('\n')))}>
            Copy details
          </button>
        </div>
        <p className="hint">
          If this keeps happening, paste the copied details into the chat so the cause can be fixed.
        </p>
      </div>
    )
  }

  if (!models)
    return (
      <div className="tab-body">
        <p className="hint">
          Reading every mob model from your Minecraft client. This runs the game's own model code once (about 10–30
          seconds) and is cached afterwards.
        </p>
        {log.length > 0 && (
          <div className="log">
            {log.map((l, i) => (
              <div key={i}>{l}</div>
            ))}
          </div>
        )}
      </div>
    )

  return (
    <div className="tab-body">
      <label className="field">
        <span>Search</span>
        <input value={filter} placeholder="zombie, creeper, chest…" onChange={(e) => setFilter(e.target.value)} />
      </label>
      <label className="check">
        <input type="checkbox" checked={allLayers} onChange={(e) => setAllLayers(e.target.checked)} />
        <span>Show extra layers (armor, outer layers, saddles…)</span>
      </label>
      {filter.trim() ? (
        <>
          <MobGrid keys={matches} models={models} onAdd={add} />
          {matches.length === 0 && <p className="hint">Nothing matches “{filter}”.</p>}
        </>
      ) : (
        ENTITY_CATEGORIES.filter((c) => byCategory.get(c.id)?.length).map((c) => (
          <ColorSection
            key={c.id}
            id={`mobs-${c.id}`}
            title={c.label}
            color={CATEGORY_COLOURS[c.id]}
            count={byCategory.get(c.id)!.length}
            defaultOpen={c.id === 'mobs'}
          >
            <MobGrid keys={byCategory.get(c.id)!} models={models} onAdd={add} />
          </ColorSection>
        ))
      )}
      <Hint>
        {Object.keys(models.layers).length} models exported from Minecraft {models.version}'s own code, with textures
        from your jar. Pick a different texture variant (e.g. biome villagers, cat breeds) and pose limbs in the
        properties panel.
      </Hint>
    </div>
  )
}
