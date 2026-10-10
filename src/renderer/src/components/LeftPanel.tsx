import { useState, type ReactNode } from 'react'
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

interface TabDef {
  id: string
  label: string
  icon: LucideIcon
  title: string
  subtitle: string
  body: () => ReactNode
}

/** One rail icon per kind of thing you can add; each opens a single asset panel (Canva/Figma pattern). */
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
  const [tab, setTab] = useState('biomes')
  const current = TABS.find((t) => t.id === tab)!
  return (
    <>
      <nav className="rail" aria-label="Add to scene">
        {TABS.map((t) => (
          <button
            key={t.id}
            className={`rail-item ${t.id === tab ? 'active' : ''}`}
            onClick={() => setTab(t.id)}
            title={t.subtitle}
          >
            <t.icon size={21} strokeWidth={1.8} />
            <span>{t.label}</span>
          </button>
        ))}
      </nav>
      <aside className="asset-panel">
        <header className="panel-header">
          <h2>{current.title}</h2>
          <p>{current.subtitle}</p>
        </header>
        <div className="panel-scroll" key={current.id}>
          {current.body()}
        </div>
      </aside>
    </>
  )
}
