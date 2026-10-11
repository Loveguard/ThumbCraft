import type { ReactNode } from 'react'
import {
  Box,
  Castle,
  CloudSun,
  Flame,
  Image as ImageIcon,
  Lightbulb,
  Mountain,
  Type,
  User,
  WandSparkles,
  type LucideIcon
} from 'lucide-react'
import { BuildsTab } from './tabs/BuildsTab'
import { EffectsTab } from './tabs/EffectsTab'
import { LightsTab } from './tabs/LightsTab'
import { MobsTab } from './tabs/MobsTab'
import { SkyTab } from './tabs/SkyTab'
import { VfxTab } from './tabs/VfxTab'
import { MediaTab, PlayersTab, TextTab, WorldTab } from './tabs/SceneTabs'
import { useLayout } from '../layout'

interface TabDef {
  id: string
  label: string
  icon: LucideIcon
  title: string
  subtitle: string
  body: () => ReactNode
}

/**
 * One rail icon per kind of thing you can add; each opens a single asset panel (Canva/Figma pattern). The icons
 * carry no captions: the name and what it adds show on hover, and clicking the open one folds the panel away.
 */
const TABS: TabDef[] = [
  {
    id: 'biomes',
    label: 'Biomes',
    icon: Mountain,
    title: 'Biomes',
    subtitle: 'Real terrain from the Minecraft world generator',
    body: () => <WorldTab />
  },
  {
    id: 'builds',
    label: 'Builds',
    icon: Castle,
    title: 'Builds',
    subtitle: 'Structures from your game, plus schematic files',
    body: () => <BuildsTab />
  },
  {
    id: 'players',
    label: 'Players',
    icon: User,
    title: 'Players',
    subtitle: 'Any Minecraft account’s skin, posed in 3D',
    body: () => <PlayersTab />
  },
  {
    id: 'mobs',
    label: 'Mobs',
    icon: Box,
    title: 'Mobs & entities',
    subtitle: 'Mobs, chests, boats and more, from the game’s own code',
    body: () => <MobsTab />
  },
  {
    id: 'media',
    label: 'Media',
    icon: ImageIcon,
    title: 'Media',
    subtitle: 'Your own images, videos and 3D models',
    body: () => <MediaTab />
  },
  {
    id: 'text',
    label: 'Text',
    icon: Type,
    title: 'Text',
    subtitle: 'Bold titles and 3D Minecraft lettering',
    body: () => <TextTab />
  },
  {
    id: 'lights',
    label: 'Lights',
    icon: Lightbulb,
    title: 'Lights',
    subtitle: 'Coloured lights, shadow patterns and reflections',
    body: () => <LightsTab />
  },
  {
    id: 'sky',
    label: 'Sky',
    icon: CloudSun,
    title: 'Sky',
    subtitle: 'Presets or your own HDRI panorama',
    body: () => <SkyTab />
  },
  {
    id: 'vfx',
    label: 'FX',
    icon: Flame,
    title: 'Special effects',
    subtitle: 'Smoke, fire, explosions, magic, weather and the game’s particles',
    body: () => <VfxTab />
  },
  {
    id: 'effects',
    label: 'Look',
    icon: WandSparkles,
    title: 'Look',
    subtitle: 'Colour grading, lens and light effects',
    body: () => <EffectsTab />
  }
]

export function LeftPanel(): ReactNode {
  const tab = useLayout((s) => s.assetTab)
  const focus = useLayout((s) => s.focus)
  const toggle = useLayout((s) => s.toggleAssetTab)
  const current = focus ? undefined : TABS.find((t) => t.id === tab)
  return (
    <>
      <nav className="rail" aria-label="Add to scene">
        {TABS.map((t) => (
          <button
            key={t.id}
            className={`rail-item ${t.id === current?.id ? 'active' : ''}`}
            onClick={() => toggle(t.id)}
            aria-label={t.label}
            aria-pressed={t.id === current?.id}
            data-tip={t.title}
            data-tip-sub={t.subtitle}
          >
            <t.icon size={20} strokeWidth={1.7} />
          </button>
        ))}
      </nav>
      {current && (
        <aside className="asset-panel">
          <header className="panel-header" title={current.subtitle}>
            <h2>{current.title}</h2>
          </header>
          <div className="panel-scroll" key={current.id}>
            {current.body()}
          </div>
        </aside>
      )}
    </>
  )
}
