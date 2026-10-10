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
  Gem,
  Zap,
  type LucideIcon
} from 'lucide-react'
import { placeNew } from '../../placement'
import { newId, useStore } from '../../store'
import { VFX_PRESETS, vfxBounds, type VfxPreset, type VfxType } from '../../vfx'
import { ColorSection, Hint } from '../controls'
import { ParticlesTab } from './ParticlesTab'
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
  shine: Gem,
  totem: PartyPopper,
  impact: Radar,
  beacon: SunDim
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
    s.setStatus('Tip: switch to Cinematic (Render & camera, right panel) so the effect lights up its surroundings.')
}

/** A vanilla-shaped lightning bolt striking where you're looking, slimmer than the game's for a crisp look. */
function addLightning(): void {
  useStore.getState().add({
    id: newId('obj'),
    kind: 'lightning',
    name: 'Lightning',
    seed: Math.floor(Math.random() * 2 ** 31),
    color: '#737380', // vanilla's (0.45, 0.45, 0.5)
    brightness: 1.5,
    thickness: 0.5,
    flash: true,
    visible: true,
    ...placeNew('ground'),
    scale: 1
  })
}

/** Effects placed in the 3D scene: smoke, fog, fire, explosions and more, plus weather. */
export function VfxTab(): ReactNode {
  return (
    <div className="tab-body">
      <div className="tile-grid cols-3">
        {VFX_PRESETS.filter((p) => !p.retired).map((p) => {
          const Icon = ICONS[p.id]
          const tile = (
            <button key={p.id} title={p.hint} onClick={() => addEffect(p)}>
              <span className="light-dot" style={{ background: p.color }}>
                <Icon size={14} />
              </span>
              {p.label}
            </button>
          )
          // Lightning sits after the light beam, before the shine.
          if (p.id !== 'shine') return tile
          return [
            <button
              key="lightning"
              title="A vanilla lightning bolt striking where you're looking (128 blocks tall like in game; scale it down for a closer strike)"
              onClick={addLightning}
            >
              <span className="light-dot" style={{ background: '#c7d2fe' }}>
                <Zap size={14} />
              </span>
              Lightning
            </button>,
            tile
          ]
        })}
      </div>
      <Hint>
        Effects appear where you are looking; move and scale them with the gizmo. In the properties panel you can change
        the colour, thickness and see-through, or reshuffle the puffs for a different shape. Bloom (Look tab) makes fire
        and sparks glow.
      </Hint>
      <hr />
      <WeatherControls />
      <ColorSection id="fx-particles" title="Game particles" color="#f472b6" defaultOpen={false}>
        <ParticlesTab embedded />
      </ColorSection>
    </div>
  )
}
