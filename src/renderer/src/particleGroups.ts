// Sorts the game's particle textures for the Particles tab: animation frames (explosion_0…15) fold into
// one particle, and particles are grouped by what they look like.

export interface Particle {
  name: string
  label: string
  /** Texture paths (particle/…), in frame order. */
  frames: string[]
}

export interface ParticleCategory {
  label: string
  particles: Particle[]
}

const CATEGORIES: [string, RegExp][] = [
  ['Fire & smoke', /flame|lava|smoke|generic|explosion|flash|ash|ember/],
  ['Hearts & reactions', /heart|angry|damage|note|crit/],
  ['Water', /bubble|splash|drip|rain|nautilus/],
  ['Magic', /effect|spell|glint|enchant|sga|glitter|spark|soul|totem|portal|witch|end_rod/],
  ['Sculk & trials', /sculk|shriek|vibration|sonic|trial|vault|omen|ominous|spawner|infested/],
  ['Nature', /cherry|leaf|leaves|pale|firefly|spore|pollen|petal|snow/],
  ['Wind', /gust|wind/]
]

const frameOf = (path: string): number => {
  const m = /_(\d+|[a-z])$/.exec(path)
  if (!m) return 0
  return /\d/.test(m[1]) ? Number(m[1]) : m[1].charCodeAt(0)
}

export function groupParticles(textures: string[]): ParticleCategory[] {
  const byName = new Map<string, string[]>()
  for (const t of textures) {
    if (!t.startsWith('particle/')) continue
    const file = t.slice('particle/'.length)
    // Numbered frames, plus the enchanting table's glyphs (sga_a…sga_z).
    const name = file.replace(/_\d+$/, '').replace(/^sga_[a-z]$/, 'sga')
    byName.set(name, [...(byName.get(name) ?? []), t])
  }
  const cats = new Map<string, Particle[]>()
  for (const [name, frames] of byName) {
    const cat = CATEGORIES.find(([, re]) => re.test(name))?.[0] ?? 'Other'
    const label = name === 'sga' ? 'Enchanting glyphs' : name.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase())
    cats.set(cat, [...(cats.get(cat) ?? []), { name, label, frames: frames.sort((a, b) => frameOf(a) - frameOf(b)) }])
  }
  const order = [...CATEGORIES.map(([l]) => l), 'Other']
  return order
    .filter((l) => cats.has(l))
    .map((label) => ({ label, particles: cats.get(label)!.sort((a, b) => a.label.localeCompare(b.label)) }))
}

/** The frame shown on a particle's tile and added first: the middle of an animation reads best. */
export const keyFrame = (p: Particle): string => p.frames[Math.floor((p.frames.length - 1) / 2)]
