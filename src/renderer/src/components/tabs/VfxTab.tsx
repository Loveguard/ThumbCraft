import type { ReactNode } from 'react'
import {
  Cloud,
  CloudFog,
  Flame,
  Bomb,
  Sparkle,
  Sparkles,
  SunDim,
  PartyPopper,
  Radar,
  type LucideIcon
} from 'lucide-react'
import { placeNew } from '../../placement'
import { newId, useStore } from '../../store'
import { VFX_PRESETS, vfxBounds, type VfxPreset, type VfxType } from '../../vfx'
import { Hint } from '../controls'
import { WeatherControls } from './SkyTab'
import { isLit } from '../../renderModes'

const ICONS: Record<VfxType, LucideIcon> = {
  smoke: Cloud,
  fog: CloudFog,
  fire: Flame,
  explosion: Bomb,
  embers: Sparkle,
  magic: Sparkles,
  beam: SunDim,
  totem: PartyPopper,
  impact: Radar
}

function addEffect(p: VfxPreset): void {
  const s = useStore.getState()
  s.add({
    id: newId('obj'),
    kind: 'vfx',
    name: p.label,
    effect: p.id,
    color: p.color,
    density: p.density,
    opacity: 1,
    glow: p.glow,
    seed: Math.floor(Math.random() * 2 ** 31),
    visible: true,
    ...placeNew('ground', vfxBounds(p.id)[0]),
    scale: 1
  })
  if (p.glow && !isLit(s.settings.renderMode))
    s.setStatus('Tip: switch to Cinematic (Scene & lighting) so the effect lights up its surroundings.')
}

/** Effects placed in the 3D scene: smoke, fog, fire, explosions and more, plus weather. */
export function VfxTab(): ReactNode {
  return (
    <div className="tab-body">
      <div className="tile-grid cols-3">
        {VFX_PRESETS.map((p) => {
          const Icon = ICONS[p.id]
          return (
            <button key={p.id} title={p.hint} onClick={() => addEffect(p)}>
              <span className="light-dot" style={{ background: p.color }}>
                <Icon size={14} />
              </span>
              {p.label}
            </button>
          )
        })}
      </div>
      <Hint>
        Effects appear where you are looking; move and scale them with the gizmo. In the properties panel you can change
        the colour, thickness and see-through, or reshuffle the puffs for a different shape. Bloom (Look tab) makes fire
        and sparks glow.
      </Hint>
      <hr />
      <WeatherControls />
    </div>
  )
}
