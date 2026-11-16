import type { ReactNode } from 'react'
import { Lightbulb, RectangleVertical, Sun } from 'lucide-react'
import { addLight, LIGHT_PRESETS } from '../../lights'
import { placeNew } from '../../placement'
import { useShallow } from 'zustand/react/shallow'
import { newId, useStore } from '../../store'
import { Hint, Slider, Toggle } from '../controls'
import { isLit } from '../../renderModes'

const percent = (v: number): string => `${Math.round(v * 100)}%`

export function LightsTab(): ReactNode {
  const { renderMode, sunStrength, ambientStrength, blockGlow, waterReflections } = useStore(
    useShallow(({ settings: t }) => ({
      renderMode: t.renderMode,
      sunStrength: t.sunStrength,
      ambientStrength: t.ambientStrength,
      blockGlow: t.blockGlow,
      waterReflections: t.waterReflections
    }))
  )
  const { setSettings } = useStore.getState()
  return (
    <div className="tab-body">
      <h4>Add a light</h4>
      <div className="tile-grid">
        {LIGHT_PRESETS.map((p) => (
          <button key={p.id} title={p.hint} onClick={() => addLight(p.id)}>
            <span className="light-dot" style={{ background: p.light.color }}>
              <Lightbulb size={14} />
            </span>
            {p.id}
          </button>
        ))}
      </div>
      <Hint>
        Lights appear where you are looking. Move them with the gizmo; rotate a spotlight to aim it. Spotlights can
        project a pattern (window, leaves, stained glass or your own image) from the inspector.
      </Hint>

      <h4>Scene lighting</h4>
      {!isLit(renderMode) && (
        <p className="hint">
          Placed lights and these sliders work in Cinematic mode.{' '}
          <button className="link" onClick={() => setSettings({ renderMode: 'cinematic' })}>
            Switch to Cinematic
          </button>
        </p>
      )}
      <Slider
        label={
          <>
            <Sun size={13} /> Sun
          </>
        }
        min={0}
        max={2}
        step={0.05}
        value={sunStrength}
        format={percent}
        onChange={(sunStrength) => setSettings({ sunStrength })}
      />
      <Slider
        label="Ambient"
        min={0}
        max={2}
        step={0.05}
        value={ambientStrength}
        format={percent}
        onChange={(ambientStrength) => setSettings({ ambientStrength })}
      />
      <Slider
        label="Glowing blocks"
        title="Torches, lanterns, lava, glowstone and other light-giving blocks"
        min={0}
        max={3}
        step={0.05}
        value={blockGlow}
        format={percent}
        onChange={(blockGlow) => setSettings({ blockGlow })}
      />
      <Hint>For a night scene, pick the Night sky: it turns the sun off and dims the fill.</Hint>

      <h4>Reflections</h4>
      <button
        onClick={() =>
          useStore.getState().add({
            id: newId('obj'),
            kind: 'mirror',
            name: 'Mirror',
            width: 2,
            height: 3,
            tint: '#e6e6e6',
            frame: true,
            visible: true,
            ...placeNew('ground'),
            scale: 1
          })
        }
      >
        <RectangleVertical size={15} /> Add mirror
      </button>
      <Toggle
        label="Reflective water"
        title="Lakes and oceans mirror the scene"
        checked={waterReflections}
        onChange={(on) => setSettings({ waterReflections: on })}
      />
    </div>
  )
}
