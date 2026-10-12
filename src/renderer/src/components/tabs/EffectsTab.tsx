import type { ReactNode } from 'react'
import { useStore, type EffectSettings } from '../../store'
import { sunInView } from '../Effects'
import { gradeColor, LOOKS, lookSettings, parseCube, type Grade } from '../../grading'
import { registerMedia } from '../../media'
import { errorText } from '../../errors'
import { viewport } from '../Viewport'
import { ColorSection, Group, Hint, Slider, Toggle } from '../controls'

type NumKey = { [K in keyof EffectSettings]: EffectSettings[K] extends number ? K : never }[keyof EffectSettings]
type BoolKey = { [K in keyof EffectSettings]: EffectSettings[K] extends boolean ? K : never }[keyof EffectSettings]

/** A shared slider bound to one effect setting. */
export function FxSlider({
  k,
  ...rest
}: {
  k: NumKey
  label: string
  min: number
  max: number
  step: number
}): ReactNode {
  const value = useStore((s) => s.effects[k])
  return (
    <Slider
      {...rest}
      value={value}
      format={(v) => String(Math.round(v * 1000) / 1000)}
      onChange={(v) => useStore.getState().setEffects({ [k]: v })}
    />
  )
}

export function FxGroup({
  k,
  label,
  children,
  onEnable
}: {
  k: BoolKey
  label: string
  children?: ReactNode
  onEnable?: () => void
}): ReactNode {
  const on = useStore((s) => s.effects[k])
  const setEffects = useStore((s) => s.setEffects)
  return (
    <div className={`group fx ${on ? 'open' : ''}`}>
      <label className="fx-head">
        <span>{label}</span>
        <input
          type="checkbox"
          role="switch"
          checked={on}
          onChange={(e) => {
            setEffects({ [k]: e.target.checked })
            if (e.target.checked) onEnable?.()
          }}
        />
      </label>
      {on && children && <div className="group-body">{children}</div>}
    </div>
  )
}

export function EffectsTab(): ReactNode {
  const setSettings = useStore((s) => s.setSettings)
  const setEffects = useStore((s) => s.setEffects)
  const { shadowTint, highlightTint, cleanOverlays, crtOverLayers, streakColor, depthOfField, paperMobs } = useStore(
    (s) => s.effects
  )
  const putSunInView = (): void => {
    const sun = sunInView(viewport.camera)
    if (sun) setSettings(sun)
  }
  const applyLook = (id: string | null): void => {
    if (!id) return setEffects({ look: null })
    const { sunInView: moveSun, ...settings } = lookSettings(id)
    setEffects(settings)
    if (moveSun) putSunInView()
  }
  return (
    <div className="tab-body">
      <Toggle
        label="Keep titles clean"
        title="Always-on-top layers (titles) are drawn after the effects, so blur, grain, looks and lens effects skip them"
        checked={cleanOverlays}
        onChange={(on) => setEffects({ cleanOverlays: on })}
      />

      <ColorSection id="fx-look" title="Look" color="#b48cff" defaultOpen>
        <LookPicker onPick={applyLook} />
      </ColorSection>

      <ColorSection id="fx-adjust" title="Adjust" color="#60a5fa">
        <FxSlider k="exposure" label="Exposure" min={-2} max={2} step={0.05} />
        <FxSlider k="contrast" label="Contrast" min={-0.6} max={0.6} step={0.01} />
        <FxSlider k="saturation" label="Saturation" min={-1} max={1} step={0.01} />
        <FxSlider k="temperature" label="Warmth" min={-1} max={1} step={0.01} />
        <FxSlider k="tint" label="Tint" min={-1} max={1} step={0.01} />
        <Group id="fx-split" title="Split toning">
          <div className="row">
            <label className="field">
              <span>Shadows</span>
              <input type="color" value={shadowTint} onChange={(e) => setEffects({ shadowTint: e.target.value })} />
            </label>
            <label className="field">
              <span>Highlights</span>
              <input
                type="color"
                value={highlightTint}
                onChange={(e) => setEffects({ highlightTint: e.target.value })}
              />
            </label>
          </div>
          <FxSlider k="split" label="Strength" min={0} max={1} step={0.01} />
        </Group>
      </ColorSection>

      <ColorSection id="fx-focus" title="Focus" color="#5eead4" defaultOpen={depthOfField}>
        <FxGroup k="depthOfField" label="Focus blur (depth of field)">
          <FxSlider k="dofBlur" label="Blur" min={0.5} max={10} step={0.1} />
          <FxSlider k="dofRange" label="In-focus depth" min={0.5} max={40} step={0.5} />
          <button onClick={() => setEffects({ focusPoints: [{ x: 0.5, y: 0.55 }] })}>Reset focus points</button>
          <Hint>
            Drag the focus point in the viewport onto what should be sharp: whatever is under it stays in focus. Use the
            + on its edge to add more points for several subjects.
          </Hint>
        </FxGroup>
      </ColorSection>

      <ColorSection id="fx-lens" title="Lens" color="#fbbf24">
        <FxGroup k="warp" label="Lens warp">
          <FxSlider k="warpAmount" label="Pinch ↔ Bulge" min={-1} max={1} step={0.01} />
          <Hint>
            Right curves the picture like a curved TV or fisheye; left pinches it. The frame always stays full.
          </Hint>
        </FxGroup>
        <FxGroup k="burst" label="Speed burst">
          <FxSlider k="burstAmount" label="Strength" min={0} max={1} step={0.01} />
          <FxSlider k="burstClear" label="Clear centre" min={0} max={1} step={0.01} />
          <FxSlider k="burstX" label="Centre left ↔ right" min={0} max={1} step={0.01} />
          <FxSlider k="burstY" label="Centre top ↔ bottom" min={0} max={1} step={0.01} />
        </FxGroup>
        <FxGroup k="streaks" label="Anamorphic streaks">
          <FxSlider k="streakAmount" label="Strength" min={0} max={2} step={0.01} />
          <FxSlider k="streakThreshold" label="Threshold" min={0.6} max={3} step={0.05} />
          <label className="field">
            <span>Colour</span>
            <input type="color" value={streakColor} onChange={(e) => setEffects({ streakColor: e.target.value })} />
          </label>
        </FxGroup>
        <FxGroup k="chromatic" label="Chromatic aberration">
          <FxSlider k="chromaticAmount" label="Amount" min={0} max={0.01} step={0.0005} />
        </FxGroup>
      </ColorSection>

      <ColorSection id="fx-overlays" title="Overlays" color="#f472b6">
        <FxGroup k="vignette" label="Vignette">
          <FxSlider k="vignetteDarkness" label="Darkness" min={0} max={1} step={0.01} />
          <FxSlider k="vignetteOffset" label="Size" min={0} max={1} step={0.01} />
        </FxGroup>
        <FxGroup k="grain" label="Film grain">
          <FxSlider k="grainAmount" label="Amount" min={0} max={0.6} step={0.01} />
        </FxGroup>
        <FxGroup k="paper" label="Paper cutout">
          <FxSlider k="paperEdge" label="Torn border" min={0} max={24} step={0.5} />
          <FxSlider k="paperRough" label="Ripped edge" min={0} max={1} step={0.01} />
          <FxSlider k="paperShadow" label="Drop shadow" min={0} max={1} step={0.01} />
          <Toggle
            label="Mobs too"
            title="Off: only players get the torn paper border. On: mobs get it as well"
            checked={paperMobs}
            onChange={(on) => setEffects({ paperMobs: on })}
          />
          <Hint>Players look torn out of a photo and stuck onto the scene, with a ragged paper border.</Hint>
        </FxGroup>
        <FxGroup k="folds" label="Paper folds">
          <FxSlider k="paperFolds" label="Amount" min={0} max={1} step={0.01} />
          <Hint>Creases, crumpling and paper fibre, as if the picture were a print that's been folded.</Hint>
        </FxGroup>
        <FxGroup k="halation" label="Film halation">
          <FxSlider k="paperHalation" label="Glow" min={0} max={1.5} step={0.01} />
          <Hint>A red-orange glow bleeding around bright highlights, like on real film.</Hint>
        </FxGroup>
        <FxGroup k="fuji" label="Fujifilm colour">
          <FxSlider k="paperFuji" label="Strength" min={0} max={1} step={0.01} />
          <Hint>Teal-leaning greens, soft lifted shadows and warm highlights. Works on top of any Look.</Hint>
        </FxGroup>
        <FxGroup k="lightLeak" label="Light leak">
          <FxSlider k="lightLeakAmount" label="Strength" min={0} max={1.5} step={0.01} />
          <FxSlider k="lightLeakX" label="Position left ↔ right" min={0} max={1} step={0.01} />
          <Hint>Warm orange light fogging in from the top of the frame, like a film camera opened too soon.</Hint>
        </FxGroup>
        <FxGroup k="crt" label="CRT TV">
          <FxSlider k="crtAmount" label="Scanlines & mask" min={0} max={1} step={0.01} />
          <FxSlider k="crtCurve" label="Screen curve" min={0} max={1} step={0.01} />
          <Toggle
            label="Also over titles"
            title="Off: titles and other always-on-top layers stay clean on top of the CRT"
            checked={crtOverLayers}
            onChange={(on) => setEffects({ crtOverLayers: on, ...(on && { cleanOverlays: true }) })}
          />
        </FxGroup>
      </ColorSection>
    </div>
  )
}

type RGB = [number, number, number]
/** A tiny pixel-art scene each look is previewed on: sky with a low sun, hills, a tree, grass and a player. */
function previewScene(): RGB[][] {
  const W = 64
  const H = 28
  const px: RGB[][] = []
  const box = (x0: number, y0: number, x1: number, y1: number, c: RGB): void => {
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) px[y][x] = c
  }
  for (let y = 0; y < H; y++) {
    px.push([])
    for (let x = 0; x < W; x++) {
      const t = y / 16
      const sun = Math.max(0, 1 - Math.hypot(x - 48, y - 9) / 14)
      px[y].push([
        Math.min(1, 0.32 + 0.55 * t + 0.5 * sun),
        Math.min(1, 0.52 + 0.36 * t + 0.35 * sun),
        Math.min(1, 0.92 + 0.06 * t + 0.05 * sun)
      ])
    }
  }
  for (let x = 0; x < W; x++) {
    const hill = 15 + Math.round(2 * Math.sin(x / 5) + Math.sin(x / 2.3))
    box(x, hill, x + 1, 19, [0.2, 0.36, 0.2])
  }
  box(0, 19, W, H, [0.42, 0.68, 0.28])
  box(0, 25, W, H, [0.5, 0.36, 0.24])
  box(5, 5, 17, 13, [0.2, 0.42, 0.16])
  box(10, 13, 12, 21, [0.4, 0.28, 0.17])
  box(30, 20, 40, 22, [0.3, 0.5, 0.2])
  box(32, 8, 38, 10, [0.25, 0.17, 0.1])
  box(32, 10, 38, 14, [0.85, 0.62, 0.48])
  box(33, 11, 34, 12, [0.25, 0.3, 0.75])
  box(36, 11, 37, 12, [0.25, 0.3, 0.75])
  box(31, 14, 39, 19, [0.0, 0.62, 0.62])
  box(32, 19, 38, 22, [0.25, 0.25, 0.62])
  return px
}
const previews = new Map<string, string>()
/** The preview scene with a look applied, as an image (made once per look). */
function lookPreview(key: string, g: Grade | null): string {
  const hit = previews.get(key)
  if (hit) return hit
  const scene = previewScene()
  const canvas = document.createElement('canvas')
  canvas.width = scene[0].length
  canvas.height = scene.length
  const ctx = canvas.getContext('2d')
  if (!ctx) return ''
  const img = ctx.createImageData(canvas.width, canvas.height)
  scene.flat().forEach((c, i) => {
    const out = g ? gradeColor(c, g) : c
    for (let k = 0; k < 3; k++) img.data[i * 4 + k] = Math.round(Math.min(1, Math.max(0, out[k])) * 255)
    img.data[i * 4 + 3] = 255
  })
  ctx.putImageData(img, 0, 0)
  const url = canvas.toDataURL()
  previews.set(key, url)
  return url
}
const preview = (key: string, g: Grade | null): string => `url(${lookPreview(key, g)}) center / cover`

/** The colour looks (3D LUTs): built-in grades, or the user's own .cube file, with an intensity slider. */
function LookPicker({ onPick }: { onPick: (id: string | null) => void }): ReactNode {
  const { look, lutName } = useStore((s) => s.effects)
  const setEffects = useStore((s) => s.setEffects)
  const importCube = async (file: File | undefined): Promise<void> => {
    if (!file) return
    try {
      const bytes = new Uint8Array(await file.arrayBuffer())
      parseCube(new TextDecoder().decode(bytes)) // refuse anything that isn't a 3D LUT up front
      const media = registerMedia(file.name, 'text/plain', bytes)
      setEffects({ look: 'custom', lookIntensity: 1, lutMediaId: media.id, lutName: file.name })
    } catch (e) {
      useStore.getState().setStatus(`Couldn't use ${file.name}: ${errorText(e)}`)
    }
  }
  return (
    <>
      <div className="look-grid">
        <button className={`look-card ${!look ? 'active' : ''}`} onClick={() => onPick(null)} title="No look">
          <span className="look-strip" style={{ background: preview('none', null) }} />
          <span>None</span>
        </button>
        {LOOKS.map((l) => (
          <button
            key={l.id}
            className={`look-card ${look === l.id ? 'active' : ''}`}
            onClick={() => onPick(l.id)}
            title={l.hint}
          >
            <span className="look-strip" style={{ background: preview(l.id, l.grade) }} />
            <span>{l.label}</span>
          </button>
        ))}
        {look === 'custom' && (
          <button className="look-card active" title={lutName}>
            <span className="look-strip custom" />
            <span>{lutName.replace(/\.cube$/i, '')}</span>
          </button>
        )}
      </div>
      {look && <FxSlider k="lookIntensity" label="Intensity" min={0} max={1} step={0.01} />}
      <label className="file-button">
        <input type="file" accept=".cube" onChange={(e) => void importCube(e.target.files?.[0])} />
        Import a .cube LUT…
      </label>
      <Hint label="About looks">
        Looks are 3D colour LUTs, like in DaVinci Resolve or Premiere. Pick one, then set how strongly it applies. You
        can also import any .cube LUT you own; it is saved inside your project.
      </Hint>
    </>
  )
}
