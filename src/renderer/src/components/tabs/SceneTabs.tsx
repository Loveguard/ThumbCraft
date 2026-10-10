import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { BACKDROPS } from '@shared/minecraft/backdrops'
import { groupBiomes } from '@shared/minecraft/worldgen'
import type { JavaInfo } from '@shared/api'
import type { Dimension, GenerateProgress } from '@shared/types'
import { grassColor, type Colormaps } from '@shared/minecraft/tints'
import { assetContext } from '../../minecraft/assets'
import { defaultSkinUrl } from '../../minecraft/builders'
import { STICKERS, stickerSvg } from '../../stickers'
import { placeNew } from '../../placement'
import { biomePreview } from '../../minecraft/biomePreview'
import { fitScale, isModelFile, loadModel } from '../../minecraft/models3d'
import { registerFile } from '../../media'
import { applyReadyMadeBiome, setGround } from '../../sceneActions'
import { defaultPose, newId, NO_EQUIPMENT, useStore, type Equipment } from '../../store'
import { OUTFITS } from '../../minecraft/outfits'
import { errorText } from '../../errors'
import { hexColor } from '../../image'
import { FONTS } from '../../textStyles'
import { Group, Hint } from '../controls'

const DIMENSIONS: { id: Dimension; label: string }[] = [
  { id: 'overworld', label: 'Overworld' },
  { id: 'the_nether', label: 'Nether' },
  { id: 'the_end', label: 'The End' }
]

const pretty = (id: string): string => id.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())

/** The biome's preview scene, drawn once it scrolls into view (the gradient swatch shows until then). */
function BiomeArt({
  id,
  dimension,
  colormaps
}: {
  id: string
  dimension: Dimension
  colormaps: Colormaps | null
}): ReactNode {
  const assets = useStore((s) => s.assets)!
  const ref = useRef<HTMLImageElement>(null)
  const [src, setSrc] = useState<string | null>(null)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    let alive = true
    const io = new IntersectionObserver(([e]) => {
      if (!e.isIntersecting) return
      io.disconnect()
      void biomePreview(assets, colormaps, id, dimension).then((u) => alive && setSrc(u))
    })
    io.observe(el)
    return () => {
      alive = false
      io.disconnect()
    }
  }, [assets, colormaps, id, dimension])
  return <img ref={ref} className="biome-art" src={src ?? undefined} alt="" style={{ opacity: src ? 1 : 0 }} />
}

export function WorldTab(): ReactNode {
  const assets = useStore((s) => s.assets)!
  const groups = useMemo(() => groupBiomes(Object.keys(assets.biomes)), [assets])
  const [dimension, setDimension] = useState<Dimension>('overworld')
  const [biome, setBiome] = useState('plains')
  const [seed, setSeed] = useState('')
  const [size, setSize] = useState(48)
  const [eula, setEula] = useState(false)
  const [busy, setBusy] = useState(false)
  const [started, setStarted] = useState(0)
  const [elapsed, setElapsed] = useState(0)
  const [cancelled, setCancelled] = useState(false)
  const [log, setLog] = useState<GenerateProgress[]>([])
  const [java, setJava] = useState<JavaInfo | null | undefined>(undefined)
  const [importX, setImportX] = useState(0)
  const [importZ, setImportZ] = useState(0)
  const [colormaps, setColormaps] = useState<Colormaps | null>(null)
  useEffect(() => {
    void assetContext(assets)?.colormaps().then(setColormaps)
  }, [assets])

  /** Card background: the biome's own sky over its own grass (or fog colour in the Nether/End). */
  const swatch = (id: string): string => {
    const b = assets.biomes[id]
    const css = hexColor
    if (dimension !== 'overworld') {
      const fog = css(b?.effects.fog_color, '#3a1f1f')
      return `linear-gradient(160deg, ${fog}, #0b0b0f 130%)`
    }
    const sky = css(b?.effects.sky_color, '#78a7ff')
    const grass = colormaps ? css(grassColor(b, colormaps), '#5d9b3a') : '#5d9b3a'
    const water = css(b?.effects.water_color, '#3f76e4')
    const ground = /ocean|river|beach/.test(id) ? water : grass
    return `linear-gradient(180deg, ${sky} 0%, ${sky} 52%, ${ground} 52%, ${ground} 100%)`
  }

  // Once the EULA is accepted, start the generator in the background and pre-generate popular biomes,
  // so pressing Generate is quick (and instant for common picks).
  useEffect(() => {
    if (eula)
      void window.blockframe.prewarmGenerator(assets.version, Object.keys(assets.biomes), size).catch(() => undefined)
  }, [eula, assets, size])

  useEffect(() => {
    void window.blockframe.eulaAccepted().then(setEula)
    void window.blockframe.findJava().then(setJava)
    return window.blockframe.onGenerateProgress((p) => setLog((l) => [...l.slice(-30), p]))
  }, [])

  useEffect(() => {
    if (!groups[dimension].includes(biome)) setBiome(groups[dimension][0] ?? '')
  }, [dimension, groups, biome])

  // Start on the picked biome in the background straight away, so Generate is often instant.
  useEffect(() => {
    if (!eula || seed.trim() || !biome) return
    const t = setTimeout(
      () => void window.blockframe.prefetchBiome(assets.version, dimension, biome, size).catch(() => undefined),
      500
    )
    return () => clearTimeout(t)
  }, [eula, assets, dimension, biome, size, seed])

  // A running clock while generating, so a long wait never looks frozen.
  useEffect(() => {
    if (!busy) return
    const t = setInterval(() => setElapsed(Math.round((Date.now() - started) / 1000)), 500)
    return () => clearInterval(t)
  }, [busy, started])

  const generate = async (): Promise<void> => {
    setBusy(true)
    setCancelled(false)
    setStarted(Date.now())
    setElapsed(0)
    setLog([])
    try {
      const t = await window.blockframe.generateTerrain({
        version: assets.version,
        seed,
        dimension,
        biome,
        size,
        acceptEula: eula
      })
      setGround(t, pretty(biome))
    } catch (e) {
      const message = errorText(e)
      if (message === 'Generation cancelled') setCancelled(true)
      useStore.getState().setStatus(message)
    } finally {
      setBusy(false)
    }
  }

  const importWorld = async (): Promise<void> => {
    const dir = await window.blockframe.pickWorldFolder()
    if (!dir) return
    try {
      const t = await window.blockframe.importWorld({
        worldDir: dir,
        dimension,
        centerX: Math.round(importX),
        centerZ: Math.round(importZ),
        size
      })
      setGround(t, `World @ ${importX}, ${importZ}`)
    } catch (e) {
      useStore.getState().setStatus(errorText(e))
    }
  }

  return (
    <div className="tab-body">
      <InstantBackdrops />
      <hr />
      <div className="segmented">
        {DIMENSIONS.map((d) => (
          <button key={d.id} className={d.id === dimension ? 'active' : ''} onClick={() => setDimension(d.id)}>
            {d.label}
          </button>
        ))}
      </div>
      <div className="biome-grid">
        {groups[dimension].map((b) => (
          <button
            key={b}
            className={`biome ${b === biome ? 'active' : ''}`}
            style={{ background: swatch(b) }}
            onClick={() => setBiome(b)}
            title={b}
          >
            <BiomeArt id={b} dimension={dimension} colormaps={colormaps} />
            <span>{pretty(b)}</span>
          </button>
        ))}
      </div>
      <label className="field">
        <span>Seed</span>
        <input value={seed} placeholder="random" onChange={(e) => setSeed(e.target.value)} />
      </label>
      <label className="field">
        <span>Area</span>
        <select value={size} onChange={(e) => setSize(Number(e.target.value))}>
          {[32, 48, 64, 96].map((s) => (
            <option key={s} value={s}>
              {s} × {s} blocks
            </option>
          ))}
        </select>
      </label>
      <label className="check">
        <input
          type="checkbox"
          checked={eula}
          onChange={(e) => {
            setEula(e.target.checked)
            if (e.target.checked) void window.blockframe.acceptEula()
          }}
        />
        <span>
          I agree to the{' '}
          <a href="https://www.minecraft.net/eula" target="_blank" rel="noreferrer">
            Minecraft EULA
          </a>{' '}
          (needed to run the official world generator)
        </span>
      </label>
      {(java === null || java?.enough === false) && <JavaInstall found={java ?? null} onDone={setJava} />}
      {busy ? (
        <div className="row generating">
          <span className="gen-clock">Generating… {elapsed}s</span>
          <button onClick={() => void window.blockframe.cancelGeneration()}>Cancel</button>
        </div>
      ) : (
        <button className="primary" disabled={!eula || !biome} onClick={generate}>
          Generate {pretty(biome)}
        </button>
      )}
      {(cancelled || busy) && (
        <div className="fallback">
          <span>{cancelled ? 'Cancelled.' : 'Don’t want to wait?'} Use a ready-made biome instead:</span>
          <BackdropButtons
            onPick={() => {
              if (busy) void window.blockframe.cancelGeneration()
              setCancelled(false)
            }}
          />
        </div>
      )}
      <Hint>
        Terrain is produced by the real Minecraft {assets.version} world generator, then read block-for-block from the
        saved world.
      </Hint>
      {log.length > 0 && (
        <div className="log">
          {log.map((l, i) => (
            <div key={i} className={l.stage === 'error' ? 'err' : ''}>
              {l.message}
            </div>
          ))}
        </div>
      )}
      <Group id="world-import" title="Import from your own world">
        <div className="row">
          <label className="field">
            <span>X</span>
            <input type="number" value={importX} onChange={(e) => setImportX(Number(e.target.value))} />
          </label>
          <label className="field">
            <span>Z</span>
            <input type="number" value={importZ} onChange={(e) => setImportZ(Number(e.target.value))} />
          </label>
        </div>
        <button onClick={importWorld}>Choose a world save…</button>
      </Group>
    </div>
  )
}

/** One click to get a Java runtime the world generator can use, instead of "go install Java". */
function JavaInstall({ found, onDone }: { found: JavaInfo | null; onDone: (j: JavaInfo | null) => void }): ReactNode {
  const [progress, setProgress] = useState('')
  const [working, setWorking] = useState(false)
  useEffect(() => window.blockframe.onJavaProgress(setProgress), [])
  return (
    <div className="warn-box">
      <p className="warn">
        {found
          ? `Java ${found.version} is too old for this Minecraft version (it needs Java ${found.need}).`
          : 'No Java found. The world generator needs it.'}
      </p>
      <button
        disabled={working}
        onClick={async () => {
          setWorking(true)
          try {
            onDone(await window.blockframe.installJava())
          } catch (e) {
            setProgress(errorText(e))
          } finally {
            setWorking(false)
          }
        }}
      >
        {working ? 'Installing Java…' : 'Install Java automatically (about 50 MB)'}
      </button>
      {progress && <p className="hint">{progress}</p>}
      <p className="hint">Eclipse Temurin from Adoptium, kept inside ThumbCraft's own folder.</p>
    </div>
  )
}

/** Ready in a second, no Java: small hand-built sets made of real blocks with the game's textures. */
function BackdropButtons({ onPick }: { onPick?: () => void }): ReactNode {
  return (
    <div className="row wrap">
      {BACKDROPS.map((b) => (
        <button
          key={b.id}
          onClick={() => {
            onPick?.()
            applyReadyMadeBiome(b.id)
          }}
        >
          {b.name}
        </button>
      ))}
    </div>
  )
}

function InstantBackdrops(): ReactNode {
  return (
    <div className="instant-backdrops">
      <span className="label">Ready-made biomes · instant, swap any time</span>
      <BackdropButtons />
    </div>
  )
}

export function PlayersTab(): ReactNode {
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const add = (username: string, skinUrl: string, slim: boolean, equipment?: Equipment): void =>
    useStore.getState().add({
      id: newId('obj'),
      kind: 'player',
      name: username,
      skinUrl,
      slim,
      pose: defaultPose(),
      ...(equipment && { equipment }),
      visible: true,
      ...placeNew('ground'),
      scale: 1
    })
  const fetchSkin = async (): Promise<void> => {
    setBusy(true)
    try {
      const s = await window.blockframe.fetchSkin(name)
      add(s.username, s.skinDataUrl, s.model === 'slim')
    } catch (e) {
      useStore.getState().setStatus(errorText(e))
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="tab-body">
      <label className="field">
        <span>Username</span>
        <input
          value={name}
          placeholder="e.g. Dream"
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && fetchSkin()}
        />
      </label>
      <button className="primary" disabled={busy || !name} onClick={fetchSkin}>
        {busy ? 'Fetching skin…' : 'Add player'}
      </button>
      <Hint>Skins come straight from Mojang's session servers, including slim (Alex) arm detection.</Hint>
      <hr />
      <div className="row">
        <button onClick={() => add('Steve', defaultSkinUrl(false), false)}>Add Steve</button>
        <button onClick={() => add('Alex', defaultSkinUrl(true), true)}>Add Alex</button>
      </div>
      <h4>Characters in an outfit</h4>
      <div className="tile-grid">
        {OUTFITS.map((f) => (
          <button
            key={f.id}
            title={f.hint}
            onClick={() => add(f.label, defaultSkinUrl(false), false, { ...NO_EQUIPMENT, outfit: f.id })}
          >
            {f.label}
          </button>
        ))}
      </div>
      <Hint label="About outfits">
        Custom suits made for ThumbCraft, worn instead of armour. Any player can wear one: select it and pick an outfit
        under Equipment. The sceptre or staff goes in the main hand while it is empty.
      </Hint>
    </div>
  )
}

export function MediaTab(): ReactNode {
  const onFiles = async (files: FileList | null): Promise<void> => {
    for (const file of Array.from(files ?? [])) {
      // Keep the bytes so the file is saved inside the project.
      const media = await registerFile(file)
      const url = media.url
      const isVideo = file.type.startsWith('video/')
      const finish = (aspect: number): void =>
        useStore.getState().add({
          id: newId('obj'),
          kind: isVideo ? 'video' : 'image',
          name: file.name,
          url,
          mediaId: media.id,
          aspect,
          opacity: 1,
          onTop: false,
          visible: true,
          ...placeNew('floating'),
          scale: 1
        })
      if (isVideo) {
        const v = document.createElement('video')
        v.onloadedmetadata = () => finish(v.videoWidth / v.videoHeight || 16 / 9)
        v.src = url
      } else {
        const img = new Image()
        img.onload = () => finish(img.width / img.height || 1)
        img.src = url
      }
    }
  }
  return (
    <div className="tab-body">
      <label className="dropzone">
        <input
          type="file"
          multiple
          accept="image/png,image/webp,image/jpeg,image/gif,video/mp4,video/webm"
          onChange={(e) => {
            void onFiles(e.target.files)
            e.target.value = '' // picking the same file again should work
          }}
        />
        <strong>Import images or videos</strong>
        <span>PNG, WebP, JPG, GIF, MP4 or WebM. Transparency is kept.</span>
      </label>
      <label className="dropzone">
        <input
          type="file"
          multiple
          accept=".glb,.gltf,.obj,.mtl,.bin,.png,.jpg,.jpeg,.webp"
          onChange={(e) => {
            void importModels(e.target.files)
            e.target.value = ''
          }}
        />
        <strong>Import a 3D model</strong>
        <span>.glb, .gltf or .obj. Select its texture files along with it.</span>
      </label>
    </div>
  )
}

async function importModels(files: FileList | null): Promise<void> {
  const list = Array.from(files ?? [])
  const mains = list.filter((f) => isModelFile(f.name))
  if (!mains.length) {
    useStore.getState().setStatus('Pick a .glb, .gltf or .obj file (plus its textures if it has separate ones).')
    return
  }
  const extras = await Promise.all(list.filter((f) => !isModelFile(f.name)).map((f) => registerFile(f)))
  for (const file of mains) {
    const media = await registerFile(file)
    try {
      const model = await loadModel(media, extras)
      useStore.getState().add({
        id: newId('obj'),
        kind: 'model',
        name: file.name.replace(/\.[^.]+$/, ''),
        mediaId: media.id,
        extraMediaIds: extras.map((m) => m.id),
        visible: true,
        ...placeNew('ground'),
        scale: fitScale(model.userData.size as number[])
      })
    } catch (e) {
      useStore.getState().setStatus(`Couldn't open ${file.name}: ${errorText(e)}`)
    }
  }
}

/** The two title looks (carved stone, front-on hardcore) and the colour each starts with. */
export const TITLE_STYLES = [
  { style: 'stone', label: 'Stone', color: '#d9d4d1' },
  { style: 'hardcore', label: 'Hardcore', color: '#f0261c' }
] as const

/** Quick colours for titles: stone, ores and gems. */
export const TITLE_SWATCHES = [
  { name: 'Stone', color: '#d9d4d1' },
  { name: 'Gold', color: '#ffd23f' },
  { name: 'Diamond', color: '#5fe6ff' },
  { name: 'Emerald', color: '#3fe07a' },
  { name: 'Redstone', color: '#f0261c' },
  { name: 'Amethyst', color: '#b77cff' },
  { name: 'Obsidian', color: '#5a4a86' },
  { name: 'Snow', color: '#ffffff' }
]

export function TextTab(): ReactNode {
  const [text, setText] = useState('EPIC BASE!')
  const base = { visible: true, scale: 1 }
  return (
    <div className="tab-body">
      <label className="field col">
        <span>Text</span>
        <textarea rows={2} value={text} onChange={(e) => setText(e.target.value)} />
      </label>
      <button
        className="primary"
        onClick={() =>
          useStore.getState().add({
            ...base,
            id: newId('obj'),
            kind: 'text',
            name: `Text: ${text.slice(0, 16)}`,
            text,
            color: '#ffe14d',
            outlineColor: '#000000',
            outlineWidth: 14,
            font: FONTS[0].family,
            shadow: true,
            onTop: true,
            ...placeNew('floating')
          })
        }
      >
        Add title text
      </button>
      <button
        onClick={() =>
          useStore.getState().add({
            ...base,
            id: newId('obj'),
            kind: 'pixelText',
            name: `3D: ${text.slice(0, 16)}`,
            text,
            color: '#ffffff',
            depth: 2,
            shadow: true,
            ...placeNew('floating')
          })
        }
      >
        Add 3D Minecraft-font text
      </button>
      <div className="row">
        {TITLE_STYLES.map((t) => (
          <button
            key={t.style}
            onClick={() =>
              useStore.getState().add({
                ...base,
                id: newId('obj'),
                kind: 'pixelText',
                name: `${t.label}: ${text.slice(0, 16)}`,
                text,
                color: t.color,
                depth: 4,
                shadow: true,
                style: t.style,
                ...placeNew('floating')
              })
            }
          >
            Add {t.label.toLowerCase()} title
          </button>
        ))}
      </div>
      <h4>Arrows & shapes</h4>
      <div className="sticker-grid">
        {STICKERS.map((k, i) => (
          <button
            key={k.id}
            title={`Add ${k.label.toLowerCase()}`}
            dangerouslySetInnerHTML={{
              __html: stickerSvg({ shape: k.id, color: k.color, outline: true, glow: false })
            }}
            onClick={() =>
              useStore.getState().add({
                id: newId('obj'),
                kind: 'sticker',
                name: k.label,
                shape: k.id,
                color: k.color,
                outline: true,
                glow: false,
                visible: true,
                // Land near the middle, a little apart from the last one.
                position: [0.5 + ((i % 3) - 1) * 0.06, 0.5, 0],
                rotation: [0, 0, k.id === 'arrow' ? 20 : 0],
                scale: k.id === 'box' ? 0.4 : 0.28
              })
            }
          />
        ))}
      </div>
      <Hint>
        Arrows and shapes sit on the frame itself, on top of every effect, and stay put when the camera moves. 3D text
        is extruded pixel-for-pixel from Minecraft's own font texture. Stone titles are carved logo-style blocks in any
        colour; hardcore titles are front-on red letters where every O becomes the hardcore heart.
      </Hint>
    </div>
  )
}
