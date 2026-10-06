import type { ReactNode } from 'react'
import { useStore, type EffectSettings } from '../../store'
import { sunInView } from '../Effects'
import { gradeColor, LOOKS, lookSettings, parseCube, type Grade } from '../../grading'
import { registerMedia } from '../../media'
import { errorText } from '../../errors'
import { viewport } from '../Viewport'
import { Group, Hint, Slider } from '../controls'

type NumKey = { [K in keyof EffectSettings]: EffectSettings[K] extends number ? K : never }[keyof EffectSettings]
type BoolKey = { [K in keyof EffectSettings]: EffectSettings[K] extends boolean ? K : never }[keyof EffectSettings]

/** A shared slider bound to one effect setting. */
function FxSlider({ k, ...rest }: { k: NumKey; label: string; min: number; max: number; step: number }): ReactNode {
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

function FxGroup({
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
  const { sunAzimuth, sunElevation } = useStore((s) => s.settings)
  const setSettings = useStore((s) => s.setSettings)
  const setEffects = useStore((s) => s.setEffects)
  const { sunColor, shadowTint, highlightTint, showSun } = useStore((s) => s.effects)
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
      <LookPicker onPick={applyLook} />

      <h4>Adjust</h4>
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
            <input type="color" value={highlightTint} onChange={(e) => setEffects({ highlightTint: e.target.value })} />
          </label>
        </div>
        <FxSlider k="split" label="Strength" min={0} max={1} step={0.01} />
      </Group>

      <h4>Lens</h4>
      <FxGroup k="vignette" label="Vignette">
        <FxSlider k="vignetteDarkness" label="Darkness" min={0} max={1} step={0.01} />
        <FxSlider k="vignetteOffset" label="Size" min={0} max={1} step={0.01} />
      </FxGroup>
      <FxGroup k="grain" label="Film grain">
        <FxSlider k="grainAmount" label="Amount" min={0} max={0.6} step={0.01} />
      </FxGroup>
      <FxGroup k="chromatic" label="Chromatic aberration">
        <FxSlider k="chromaticAmount" label="Amount" min={0} max={0.01} step={0.0005} />
      </FxGroup>
      <FxGroup k="depthOfField" label="Depth of field (focus on orbit point)">
        <FxSlider k="dofBlur" label="Blur" min={0.5} max={10} step={0.1} />
        <FxSlider k="dofRange" label="Focus range" min={1} max={40} step={0.5} />
      </FxGroup>

      <h4>Light</h4>
      <FxGroup k="bloom" label="Bloom (glow)">
        <FxSlider k="bloomIntensity" label="Intensity" min={0} max={3} step={0.05} />
        <FxSlider k="bloomThreshold" label="Threshold" min={0} max={1} step={0.01} />
      </FxGroup>
      <FxGroup k="godRays" label="God rays" onEnable={putSunInView}>
        <FxSlider k="godRaysIntensity" label="Intensity" min={0} max={1.5} step={0.01} />
        <label className="field">
          <span>Sun colour</span>
          <input type="color" value={sunColor} onChange={(e) => setEffects({ sunColor: e.target.value })} />
        </label>
        <label className="check">
          <input type="checkbox" checked={showSun} onChange={(e) => setEffects({ showSun: e.target.checked })} />
          <span>Show the sun disc</span>
        </label>
      </FxGroup>
      <Group id="fx-sun" title="Sun position" defaultOpen>
        <button onClick={putSunInView}>Put sun in view</button>
        <label className="field slider">
          <span>Sun direction</span>
          <input
            type="range"
            min={-180}
            max={180}
            value={sunAzimuth}
            onChange={(e) => setSettings({ sunAzimuth: Number(e.target.value) })}
          />
          <em>{sunAzimuth}°</em>
        </label>
        <label className="field slider">
          <span>Sun height</span>
          <input
            type="range"
            min={2}
            max={89}
            value={sunElevation}
            onChange={(e) => setSettings({ sunElevation: Number(e.target.value) })}
          />
          <em>{sunElevation}°</em>
        </label>
        <Hint>
          The sun aims the scene's main light (and shadows in Cinematic mode) and the god rays: put it just behind a
          tree, player or build for the strongest rays. Effects are included in the export.
        </Hint>
      </Group>
    </div>
  )
}

/** Sample colours a look is previewed on: sky, grass, leaves, skin, dirt, stone, water, a dark shade. */
const PREVIEW: [number, number, number][] = [
  [0.47, 0.66, 1],
  [0.45, 0.73, 0.3],
  [0.25, 0.45, 0.18],
  [0.9, 0.68, 0.52],
  [0.55, 0.38, 0.25],
  [0.5, 0.5, 0.5],
  [0.2, 0.35, 0.75],
  [0.12, 0.1, 0.1]
]
const toCss = (c: number[]): string => `rgb(${c.map((v) => Math.round(v * 255)).join(',')})`
const strip = (g: Grade | null): string =>
  `linear-gradient(90deg, ${PREVIEW.map((c, i) => {
    const out = g ? gradeColor(c, g) : c
    return `${toCss(out)} ${(i / PREVIEW.length) * 100}%, ${toCss(out)} ${((i + 1) / PREVIEW.length) * 100}%`
  }).join(', ')})`

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
      <h4>Look</h4>
      <div className="look-grid">
        <button className={`look-card ${!look ? 'active' : ''}`} onClick={() => onPick(null)} title="No look">
          <span className="look-strip" style={{ background: strip(null) }} />
          <span>None</span>
        </button>
        {LOOKS.map((l) => (
          <button
            key={l.id}
            className={`look-card ${look === l.id ? 'active' : ''}`}
            onClick={() => onPick(l.id)}
            title={l.hint}
          >
            <span className="look-strip" style={{ background: strip(l.grade) }} />
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
