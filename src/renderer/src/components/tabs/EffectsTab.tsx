import type { ReactNode } from 'react'
import { useStore, type EffectSettings } from '../../store'
import { EFFECT_PRESETS, sunInView } from '../Effects'
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
  const applyPreset = (name: string): void => {
    const { sunInView: moveSun, ...preset } = EFFECT_PRESETS[name]
    setEffects(preset)
    if (moveSun) putSunInView()
  }
  return (
    <div className="tab-body">
      <h4>One-click looks</h4>
      <div className="chips">
        {Object.keys(EFFECT_PRESETS).map((p) => (
          <button key={p} className="chip" onClick={() => applyPreset(p)}>
            {p}
          </button>
        ))}
      </div>

      <h4>Colour</h4>
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
