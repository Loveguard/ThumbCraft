import type { ReactNode } from 'react'
import { Shuffle } from 'lucide-react'
import { useStore, type VfxObject } from '../store'
import { VFX_PRESETS, type VfxType } from '../vfx'
import { animationLength } from '@shared/animation'
import { Slider, Toggle } from './controls'

/** Effects that happen once, at a moment of the animation, rather than carrying on. */
const BURSTS = new Set<VfxType>(['explosion', 'totem', 'impact'])

const percent = (v: number): string => `${Math.round(v * 100)}%`

export function VfxProperties({ o }: { o: VfxObject }): ReactNode {
  const set = (patch: Partial<VfxObject>): void => useStore.getState().update(o.id, patch)
  const preset = VFX_PRESETS.find((p) => p.id === o.effect)
  const length = useStore((s) => (s.settings.animation ? animationLength(s.settings.animation) : 0))
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
      <Toggle
        label="Moves in Animation mode"
        title="Off keeps it as laid out, a still picture, in the video too"
        checked={!o.still}
        onChange={(on) => set({ still: !on })}
      />
      {BURSTS.has(o.effect) && !o.still && (
        <Slider
          label="Goes off at"
          min={0}
          max={Math.max(10, Math.ceil(length))}
          step={0.1}
          value={o.burstAt ?? 0}
          format={(v) => `${v.toFixed(1)} s`}
          onChange={(burstAt) => set({ burstAt })}
        />
      )}
      <button
        title="Rearrange the puffs for a different shape"
        onClick={() => set({ seed: Math.floor(Math.random() * 2 ** 31) })}
      >
        <Shuffle size={15} /> New shape
      </button>
    </>
  )
}
