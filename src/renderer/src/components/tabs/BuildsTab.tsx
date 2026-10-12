import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { searchStructures } from '@shared/minecraft/schematics'
import { assetContext } from '../../minecraft/assets'
import { structureThumbnail, terrainThumbnail } from '../../minecraft/thumbnails'
import {
  buildBeacon,
  buildNetherPortal,
  buildOreWall,
  buildSkyIsland,
  buildTntStack,
  buildTreasurePile,
  buildWatchtower
} from '@shared/minecraft/props'
import { startTreeBrush, stopBrush, TREE_CHOICES, useBrush } from '../../brush'
import type { TerrainData } from '@shared/types'
import { placeNew } from '../../placement'
import { addTerrain } from '../../sceneActions'
import { newId, useStore } from '../../store'
import { errorText } from '../../errors'
import { groupStructures, structureCategories, VILLAGE_BIOMES, type PieceKind } from '../../structureGroups'
import { ColorSection, Hint, Pager, Toggle, usePaged } from '../controls'

const pretty = (id: string): string => {
  const parts = id.split('/')
  return parts[parts.length - 1].replace(/_/g, ' ')
}

/** The piece rendered isometrically from the game's own blocks, once it scrolls into view. */
function StructureIcon({ id }: { id: string }): ReactNode {
  const assets = useStore((s) => s.assets)
  const ref = useRef<HTMLSpanElement>(null)
  const [src, setSrc] = useState<string | null>(null)
  useEffect(() => {
    const el = ref.current
    const ctx = assetContext(assets)
    if (!el || !ctx) return
    let alive = true
    setSrc(null)
    const io = new IntersectionObserver(([e]) => {
      if (!e.isIntersecting) return
      io.disconnect()
      void structureThumbnail(ctx, id).then((u) => alive && setSrc(u))
    })
    io.observe(el)
    return () => {
      alive = false
      io.disconnect()
    }
  }, [assets, id])
  return (
    <span ref={ref} className="asset-thumb">
      {src && <img src={src} alt="" />}
    </span>
  )
}

/** One piece; its numbered variants are stepped through with the arrows instead of listed. */
function PieceCard({ kind, busy, onAdd }: { kind: PieceKind; busy: string; onAdd: (id: string) => void }): ReactNode {
  const [v, setV] = useState(0)
  const n = kind.ids.length
  const id = kind.ids[v % n]
  const name = `${kind.label}${n > 1 ? ` · ${(v % n) + 1}/${n}` : ''}`
  return (
    <div className="piece-card">
      <button className="asset-card" disabled={!!busy} onClick={() => onAdd(id)} title={name} aria-label={name}>
        <StructureIcon id={id} />
        <span className="asset-name">{busy === id ? 'Adding…' : name}</span>
      </button>
      {n > 1 && (
        <>
          <button className="piece-step prev" title="Previous variant" onClick={() => setV((v + n - 1) % n)}>
            <ChevronLeft size={13} />
          </button>
          <button className="piece-step next" title="Next variant" onClick={() => setV((v + 1) % n)}>
            <ChevronRight size={13} />
          </button>
        </>
      )}
    </div>
  )
}

/** Small hand-built builds that thumbnails use a lot, ready in one click. */
const QUICK_PROPS: { id: string; label: string; build: () => TerrainData }[] = [
  { id: 'portal', label: 'Nether portal', build: buildNetherPortal },
  { id: 'treasure', label: 'Treasure pile', build: buildTreasurePile },
  { id: 'ore-wall', label: 'Ore vein wall', build: buildOreWall },
  { id: 'tnt', label: 'TNT stack', build: buildTntStack },
  { id: 'sky-island', label: 'Sky island', build: buildSkyIsland },
  { id: 'watchtower', label: 'Watchtower', build: buildWatchtower }
]

function PropIcon({ id, build }: { id: string; build: () => TerrainData }): ReactNode {
  const assets = useStore((s) => s.assets)
  const [src, setSrc] = useState<string | null>(null)
  useEffect(() => {
    const ctx = assetContext(assets)
    if (!ctx) return
    let alive = true
    void terrainThumbnail(ctx, id, build).then((u) => alive && setSrc(u))
    return () => {
      alive = false
    }
  }, [assets, id, build])
  return <span className="asset-thumb">{src && <img src={src} alt="" />}</span>
}

const addProp = (t: TerrainData, label: string): void =>
  addTerrain(t, label, placeNew('grid', Math.max(t.sizeX, t.sizeZ) / 2).position)

/** The beacon, lit (with the game's beam rising from it, grouped with it) or not. */
function BeaconCard(): ReactNode {
  const [lit, setLit] = useState(true)
  const name = `Beacon · ${lit ? 'lit' : 'unlit'}`
  const add = (): void => {
    const t = buildBeacon()
    const at = placeNew('grid', 1.5).position
    if (!lit) return addTerrain(t, 'Beacon', at)
    const groupId = newId('grp')
    addTerrain(t, 'Beacon', at, false, groupId)
    useStore.getState().add({
      id: newId('obj'),
      kind: 'vfx',
      name: 'Beacon beam',
      effect: 'beacon',
      color: '#ffffff',
      density: 0.5,
      opacity: 1,
      glow: false,
      seed: 1,
      visible: true,
      groupId,
      position: [at[0], at[1] + t.sizeY, at[2]],
      rotation: [0, 0, 0],
      scale: 1
    })
  }
  return (
    <div className="piece-card">
      <button className="asset-card" onClick={add} title={name} aria-label={name}>
        <PropIcon id="beacon" build={buildBeacon} />
        <span className="asset-name">{name}</span>
      </button>
      {(['prev', 'next'] as const).map((side) => (
        <button key={side} className={`piece-step ${side}`} title="Lit or unlit" onClick={() => setLit(!lit)}>
          {side === 'prev' ? <ChevronLeft size={13} /> : <ChevronRight size={13} />}
        </button>
      ))}
    </div>
  )
}

/** Turn on to plant trees with each click on the scene; pick a kind or mix them. */
function TreeBrush(): ReactNode {
  const trees = useBrush((s) => s.trees)
  return (
    <div className="tree-brush">
      <button
        className={trees ? 'primary' : ''}
        onClick={() => (trees ? stopBrush() : startTreeBrush('mixed'))}
        title="Plant trees by clicking on the ground (Esc to stop)"
      >
        {trees ? 'Stop tree brush' : 'Tree brush'}
      </button>
      {trees && (
        <>
          <div className="chips">
            {TREE_CHOICES.map((c) => (
              <button
                key={c.id}
                className={`chip ${trees === c.id ? 'active' : ''}`}
                onClick={() => startTreeBrush(c.id)}
              >
                {c.label}
              </button>
            ))}
          </div>
          <p className="hint">Click the ground to plant a tree. Each one is a little different. Esc stops.</p>
        </>
      )}
    </div>
  )
}

function QuickProps(): ReactNode {
  return (
    <>
      <div className="card-grid">
        {QUICK_PROPS.map((p) => (
          <button
            key={p.id}
            className="asset-card"
            title={p.label}
            aria-label={p.label}
            onClick={() => addProp(p.build(), p.label)}
          >
            <PropIcon id={p.id} build={p.build} />
            <span className="asset-name">{p.label}</span>
          </button>
        ))}
        <BeaconCard />
      </div>
      <TreeBrush />
    </>
  )
}

/** Accents for the structure families, in order (matching the colour-coded sections of the other tabs). */
const SECTION_COLOURS = [
  '#4ade80', // villages
  '#5eead4', // ancient city
  '#fbbf24', // trial chambers
  '#fb923c', // trail ruins
  '#b48cff', // ruined portals
  '#60a5fa', // pillager outpost
  '#38bdf8', // shipwrecks
  '#818cf8', // ocean ruins
  '#f87171', // bastion
  '#e879f9', // end city
  '#a3e635', // fossils
  '#e2e8f0', // igloo
  '#94a3b8' // other
]

/** A family's pieces, grouped by kind (houses, streets…) when there is more than one group. */
function PieceSections({
  ids,
  titled = false,
  busy,
  onAdd
}: {
  ids: string[]
  titled?: boolean
  busy: string
  onAdd: (id: string) => void
}): ReactNode {
  const sections = useMemo(() => groupStructures(ids), [ids])
  // Long families open in pages of tiles; each page keeps the headings of the groups it shows.
  const tiles = useMemo(() => sections.flatMap((s) => s.kinds.map((kind) => ({ section: s.label, kind }))), [sections])
  const { shown, ...pager } = usePaged(tiles, ids.length)
  const onPage = shown.reduce<{ label: string; kinds: PieceKind[] }[]>((out, t) => {
    if (out[out.length - 1]?.label !== t.section) out.push({ label: t.section, kinds: [] })
    out[out.length - 1].kinds.push(t.kind)
    return out
  }, [])
  return (
    <>
      {onPage.map((section) => (
        <div key={section.label} className="piece-section">
          {(sections.length > 1 || titled) && <h4>{section.label}</h4>}
          <div className="card-grid">
            {section.kinds.map((k) => (
              <PieceCard key={k.ids[0]} kind={k} busy={busy} onAdd={onAdd} />
            ))}
          </div>
        </div>
      ))}
      <Pager {...pager} />
    </>
  )
}

/** Village pieces for one biome at a time (and zombie villages on request). */
function VillagePieces({ ids, busy, onAdd }: { ids: string[]; busy: string; onAdd: (id: string) => void }): ReactNode {
  const [biome, setBiome] = useState<(typeof VILLAGE_BIOMES)[number]>('plains')
  const [zombie, setZombie] = useState(false)
  const shown = useMemo(
    () => ids.filter((id) => id.startsWith(`village/${biome}/`) && id.includes('/zombie/') === zombie),
    [ids, biome, zombie]
  )
  return (
    <>
      <div className="village-filter">
        <div className="segmented">
          {VILLAGE_BIOMES.map((b) => (
            <button key={b} className={biome === b ? 'active' : ''} onClick={() => setBiome(b)}>
              {b.charAt(0).toUpperCase() + b.slice(1)}
            </button>
          ))}
        </div>
        <Toggle label="Zombie village" checked={zombie} onChange={setZombie} />
      </div>
      <PieceSections ids={shown} busy={busy} onAdd={onAdd} />
    </>
  )
}

export function BuildsTab(): ReactNode {
  const assets = useStore((s) => s.assets)!
  const [query, setQuery] = useState('')
  const [busy, setBusy] = useState('')
  const categories = useMemo(() => structureCategories(assets.structures), [assets])
  const buildings = useMemo(() => categories.flatMap((c) => c.ids), [categories])
  const found = useMemo(() => (query.trim() ? searchStructures(buildings, query) : []), [buildings, query])
  const setStatus = useStore.getState().setStatus

  const addStructure = async (id: string): Promise<void> => {
    setBusy(id)
    try {
      const t = await window.blockframe.loadStructure(id)
      addTerrain(t, pretty(id), placeNew('grid', Math.max(t.sizeX, t.sizeZ) / 2).position)
    } catch (e) {
      setStatus(errorText(e))
    } finally {
      setBusy('')
    }
  }

  const importFile = async (): Promise<void> => {
    try {
      const r = await window.blockframe.importSchematic()
      if (r) addTerrain(r.terrain, r.name, placeNew('grid', Math.max(r.terrain.sizeX, r.terrain.sizeZ) / 2).position)
    } catch (e) {
      setStatus(errorText(e))
    }
  }

  const q = encodeURIComponent(query || 'minecraft build')
  return (
    <div className="tab-body">
      <label className="field">
        <span>Search</span>
        <input value={query} placeholder="house, portal, ship…" onChange={(e) => setQuery(e.target.value)} />
      </label>
      {!query.trim() && (
        <ColorSection id="builds-quick" title="Quick props" color="#facc15" count={QUICK_PROPS.length + 1} defaultOpen>
          <QuickProps />
        </ColorSection>
      )}
      {query.trim() ? (
        <>
          <PieceSections ids={found} titled busy={busy} onAdd={addStructure} />
          {found.length === 0 && <p className="hint">No buildings match “{query}”.</p>}
        </>
      ) : (
        categories.map((c, i) => (
          <ColorSection
            key={c.id}
            id={`builds-${c.id}`}
            title={c.label}
            color={SECTION_COLOURS[i % SECTION_COLOURS.length]}
            count={c.id === 'village' ? undefined : c.ids.length}
            defaultOpen={c.id === 'village'}
          >
            {c.id === 'village' ? (
              <VillagePieces ids={c.ids} busy={busy} onAdd={addStructure} />
            ) : (
              <PieceSections ids={c.ids} busy={busy} onAdd={addStructure} />
            )}
          </ColorSection>
        ))
      )}
      <Hint label="About these buildings">
        Pieces from Minecraft {assets.version}, exactly as the game stores them. Use the arrows on a tile to step
        through its variants. Village pieces appear before the game's random block swaps (mossy, cracked…).
      </Hint>
      <hr />
      <button className="primary" onClick={importFile}>
        Import schematic file…
      </button>
      <Hint label="Supported files">
        Supports .schem (WorldEdit/Sponge), .litematic (Litematica) and structure-block .nbt files.
      </Hint>
      <div className="links">
        <a href={`https://www.planetminecraft.com/projects/?keywords=${q}`} target="_blank" rel="noreferrer">
          Planet Minecraft
        </a>
        <a
          href={`https://www.google.com/search?q=site%3Aminecraft-schematics.com+${q}`}
          target="_blank"
          rel="noreferrer"
        >
          minecraft-schematics.com
        </a>
        <a
          href={`https://www.google.com/search?q=${q}+schematic+.schem+OR+.litematic`}
          target="_blank"
          rel="noreferrer"
        >
          Web search
        </a>
      </div>
      <Hint label="About these sites">
        These sites have no public API, so they open in your browser. Download a file, then import it here.
      </Hint>
    </div>
  )
}
