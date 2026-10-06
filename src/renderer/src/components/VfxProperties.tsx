import type { ReactNode } from 'react'
import { Shuffle } from 'lucide-react'
import { useStore, type VfxObject } from '../store'
import { VFX_PRESETS } from '../vfx'
import { Slider, Toggle } from './controls'

const percent = (v: number): string => `${Math.round(v * 100)}%`

export function VfxProperties({ o }: { o: VfxObject }): ReactNode {
  const set = (patch: Partial<VfxObject>): void => useStore.getState().update(o.id, patch)
  const preset = VFX_PRESETS.find((p) => p.id === o.effect)
  return (
    <>
      <label className="field">
        <span>Colour</span>
        <input type="color" value={o.color} onChange={(e) => set({ color: e.target.value })} />
        {preset && preset.color !== o.color && (
          <button className="ghost" onClick={() => set({ color: preset.color })}>
            Reset
          </button>
        )}
      </label>
      <Slider
        label="Thickness"
        min={0}
        max={1}
        step={0.05}
        value={o.density}
        format={percent}
        onChange={(density) => set({ density })}
      />
      <Slider
        label="Opacity"
        min={0.05}
        max={1}
        step={0.05}
        value={o.opacity}
        format={percent}
        onChange={(opacity) => set({ opacity })}
      />
      <Toggle
        label="Lights up the scene"
        title="Casts its colour on nearby blocks and players (Cinematic mode)"
        checked={o.glow}
        onChange={(glow) => set({ glow })}
      />
      <button
        title="Rearrange the puffs for a different shape"
        onClick={() => set({ seed: Math.floor(Math.random() * 2 ** 31) })}
      >
        <Shuffle size={15} /> New shape
      </button>
    </>
  )
}
