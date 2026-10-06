// Special effects placed in the 3D scene: smoke, fog, fire, explosions, embers, magic, light beams, totem
// bursts and ground impacts.
// Each is a deterministic cloud of camera-facing puffs (same seed, same look), so the viewport and the
// exported image always match.

export type VfxType = 'smoke' | 'fog' | 'fire' | 'explosion' | 'embers' | 'magic' | 'beam' | 'totem' | 'impact'

export interface VfxPreset {
  id: VfxType
  label: string
  hint: string
  color: string
  density: number
  /** Gives off light in Cinematic mode. */
  glow: boolean
}

export const VFX_PRESETS: VfxPreset[] = [
  { id: 'smoke', label: 'Smoke', hint: 'A rising plume of smoke', color: '#8a8a8a', density: 0.6, glow: false },
  {
    id: 'fog',
    label: 'Ground fog',
    hint: 'Low mist rolling over the ground',
    color: '#cfd6dd',
    density: 0.5,
    glow: false
  },
  {
    id: 'fire',
    label: 'Fire',
    hint: 'Flames with sparks, lighting their surroundings',
    color: '#ff8a2a',
    density: 0.6,
    glow: true
  },
  {
    id: 'explosion',
    label: 'Explosion',
    hint: 'A fireball bursting into smoke',
    color: '#ffa53a',
    density: 0.7,
    glow: true
  },
  {
    id: 'embers',
    label: 'Embers',
    hint: 'Glowing sparks drifting upwards',
    color: '#ff9c3a',
    density: 0.5,
    glow: true
  },
  {
    id: 'magic',
    label: 'Magic aura',
    hint: 'Swirling sparkles around a point',
    color: '#b77cff',
    density: 0.6,
    glow: true
  },
  { id: 'beam', label: 'Light beam', hint: 'A shaft of light from above', color: '#fff2c4', density: 0.5, glow: true },
  {
    id: 'totem',
    label: 'Totem pop',
    hint: 'The green and gold burst of a Totem of Undying saving a player',
    color: '#7be04a',
    density: 0.6,
    glow: true
  },
  {
    id: 'impact',
    label: 'Impact',
    hint: 'A ground shockwave of dust and flying bits, for a hard landing or a big hit',
    color: '#b8a284',
    density: 0.6,
    glow: false
  }
]

export interface Puff {
  x: number
  y: number
  z: number
  size: number
  /** Rotation in radians. */
  rot: number
  alpha: number
  /** Brightness multiplier on the layer colour. */
  shade: number
}

export interface PuffLayer {
  texture: 'puff' | 'spark'
  blending: 'normal' | 'additive'
  /** Overrides the effect's colour for this layer (the grey smoke above an explosion). */
  color?: string
  puffs: Puff[]
}

/** mulberry32: tiny seeded random, so an effect looks the same every time. */
function random(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** A point in a disc of radius r (uniform). */
function disc(rnd: () => number, r: number): [number, number] {
  const a = rnd() * Math.PI * 2
  const d = Math.sqrt(rnd()) * r
  return [Math.cos(a) * d, Math.sin(a) * d]
}

/** The puff layers an effect is drawn with, in blocks around the object's origin (at scale 1). */
export function vfxLayers(effect: VfxType, density: number, seed: number): PuffLayer[] {
  const rnd = random(seed)
  const d = Math.min(1, Math.max(0, density))
  const count = (lo: number, hi: number): number => Math.round(lo + (hi - lo) * d)
  const puff = (x: number, y: number, z: number, size: number, alpha: number, shade = 1): Puff => ({
    x,
    y,
    z,
    size,
    rot: rnd() * Math.PI * 2,
    alpha,
    shade
  })

  switch (effect) {
    case 'smoke': {
      const n = count(14, 46)
      const puffs: Puff[] = []
      for (let i = 0; i < n; i++) {
        const t = i / n
        const [x, z] = disc(rnd, 0.25 + t * 1.6)
        // Drifts a little downwind as it rises.
        puffs.push(puff(x + t * 1.2, 0.3 + t * 6, z, 0.8 + t * 2.4, 0.55 * (1 - t) ** 0.6, 0.75 + rnd() * 0.35))
      }
      return [{ texture: 'puff', blending: 'normal', puffs }]
    }
    case 'fog': {
      const n = count(30, 110)
      const puffs: Puff[] = []
      for (let i = 0; i < n; i++) {
        const [x, z] = disc(rnd, 7)
        puffs.push(puff(x, 0.2 + rnd() * 0.9, z, 2.5 + rnd() * 2.5, 0.18 + rnd() * 0.12, 0.9 + rnd() * 0.15))
      }
      return [{ texture: 'puff', blending: 'normal', puffs }]
    }
    case 'fire': {
      const flames: Puff[] = []
      for (let i = 0, n = count(18, 40); i < n; i++) {
        const t = rnd()
        const [x, z] = disc(rnd, 0.55 * (1 - t * 0.7))
        flames.push(puff(x, 0.15 + t * 1.6, z, 0.9 - t * 0.5, 0.5 * (1 - t * 0.6), 1.1 - t * 0.3))
      }
      const sparks: Puff[] = []
      for (let i = 0, n = count(8, 24); i < n; i++) {
        const [x, z] = disc(rnd, 0.9)
        sparks.push(puff(x, 0.8 + rnd() * 3, z, 0.06 + rnd() * 0.06, 0.95, 1.3))
      }
      const smoke: Puff[] = []
      for (let i = 0, n = count(4, 12); i < n; i++) {
        const t = i / 12
        const [x, z] = disc(rnd, 0.4 + t)
        smoke.push(puff(x, 2 + t * 3, z, 1 + t * 1.5, 0.3 * (1 - t), 0.7))
      }
      return [
        { texture: 'puff', blending: 'normal', color: '#3a3a3a', puffs: smoke },
        { texture: 'puff', blending: 'additive', puffs: flames },
        { texture: 'spark', blending: 'additive', puffs: sparks }
      ]
    }
    case 'explosion': {
      const core: Puff[] = []
      for (let i = 0, n = count(20, 50); i < n; i++) {
        // Points in a ball, denser at the centre.
        const u = rnd() * 2 - 1
        const a = rnd() * Math.PI * 2
        const r = 1.8 * rnd() ** 1.5
        const s = Math.sqrt(1 - u * u)
        core.push(
          puff(Math.cos(a) * s * r, 1.8 + u * r, Math.sin(a) * s * r, 1.4 + rnd() * 1.4, 0.28, 0.8 + rnd() * 0.5)
        )
      }
      const smoke: Puff[] = []
      for (let i = 0, n = count(14, 34); i < n; i++) {
        const u = rnd() * 2 - 1
        const a = rnd() * Math.PI * 2
        const r = 2 + rnd() * 1.6
        const s = Math.sqrt(1 - u * u)
        smoke.push(
          puff(Math.cos(a) * s * r, 2 + Math.abs(u) * r, Math.sin(a) * s * r, 2 + rnd() * 1.8, 0.5, 0.6 + rnd() * 0.4)
        )
      }
      const debris: Puff[] = []
      for (let i = 0, n = count(10, 30); i < n; i++) {
        const u = rnd()
        const a = rnd() * Math.PI * 2
        const r = 2 + rnd() * 3
        debris.push(puff(Math.cos(a) * r, 1 + u * 4, Math.sin(a) * r, 0.08 + rnd() * 0.1, 1, 1.4))
      }
      return [
        { texture: 'puff', blending: 'normal', color: '#4a4a4a', puffs: smoke },
        { texture: 'puff', blending: 'additive', puffs: core },
        { texture: 'spark', blending: 'additive', puffs: debris }
      ]
    }
    case 'embers': {
      const puffs: Puff[] = []
      for (let i = 0, n = count(25, 90); i < n; i++) {
        const t = rnd()
        const [x, z] = disc(rnd, 0.6 + t * 2.2)
        puffs.push(puff(x, t * 6, z, 0.05 + rnd() * 0.08, 0.6 + 0.4 * (1 - t), 1 + rnd() * 0.4))
      }
      return [{ texture: 'spark', blending: 'additive', puffs }]
    }
    case 'magic': {
      const puffs: Puff[] = []
      for (let i = 0, n = count(30, 90); i < n; i++) {
        // A loose upward spiral around the centre.
        const t = i / n
        const a = t * Math.PI * 6 + rnd() * 0.6
        const r = 0.9 + rnd() * 0.5
        puffs.push(
          puff(Math.cos(a) * r, 0.1 + t * 2.4 + rnd() * 0.2, Math.sin(a) * r, 0.06 + rnd() * 0.12, 0.9, 1 + rnd() * 0.5)
        )
      }
      const haze: Puff[] = []
      for (let i = 0; i < 6; i++) haze.push(puff(0, 0.6 + i * 0.35, 0, 1.8, 0.12, 1))
      return [
        { texture: 'puff', blending: 'additive', puffs: haze },
        { texture: 'spark', blending: 'additive', puffs }
      ]
    }
    case 'beam': {
      const dust: Puff[] = []
      for (let i = 0, n = count(10, 40); i < n; i++) {
        const t = rnd()
        const [x, z] = disc(rnd, 0.3 + t * 1.2)
        dust.push(puff(x, (1 - t) * 10, z, 0.03 + rnd() * 0.04, 0.8, 1.2))
      }
      return [{ texture: 'spark', blending: 'additive', puffs: dust }]
    }
    case 'totem': {
      // Sparks thrown out in every direction from about chest height, thickest near the player.
      const burst = (n: number): Puff[] => {
        const out: Puff[] = []
        for (let i = 0; i < n; i++) {
          const u = rnd() * 2 - 1
          const a = rnd() * Math.PI * 2
          const r = 0.5 + 2 * rnd() ** 0.7
          const s = Math.sqrt(1 - u * u)
          out.push(
            puff(Math.cos(a) * s * r, 1.3 + u * r * 0.9, Math.sin(a) * s * r, 0.07 + rnd() * 0.1, 0.95, 1 + rnd() * 0.5)
          )
        }
        return out
      }
      const glow: Puff[] = []
      for (let i = 0; i < 4; i++) glow.push(puff(0, 1.1 + i * 0.25, 0, 2.2, 0.1, 1))
      return [
        { texture: 'puff', blending: 'additive', puffs: glow },
        { texture: 'spark', blending: 'additive', puffs: burst(count(40, 120)) },
        { texture: 'spark', blending: 'additive', color: '#ffd23a', puffs: burst(count(25, 80)) }
      ]
    }
    case 'impact': {
      // A ring of dust rolling outwards along the ground, with chunks kicked up from the middle.
      const ring: Puff[] = []
      for (let i = 0, n = count(24, 60); i < n; i++) {
        const a = (i / n) * Math.PI * 2 + rnd() * 0.3
        const r = 1.6 + rnd() * 1.4
        ring.push(puff(Math.cos(a) * r, 0.3 + rnd() * 0.4, Math.sin(a) * r, 0.9 + rnd() * 0.9, 0.45, 0.8 + rnd() * 0.3))
      }
      const inner: Puff[] = []
      for (let i = 0, n = count(6, 16); i < n; i++) {
        const [x, z] = disc(rnd, 1.2)
        inner.push(puff(x, 0.4 + rnd() * 0.8, z, 1.2 + rnd() * 0.8, 0.35, 0.95))
      }
      const chunks: Puff[] = []
      for (let i = 0, n = count(10, 30); i < n; i++) {
        const a = rnd() * Math.PI * 2
        const r = 0.6 + rnd() * 2.6
        chunks.push(
          puff(Math.cos(a) * r, 0.5 + rnd() * 2.2 * (1 - r / 4), Math.sin(a) * r, 0.1 + rnd() * 0.12, 1, 0.45)
        )
      }
      return [
        { texture: 'puff', blending: 'normal', puffs: [...inner, ...ring] },
        { texture: 'puff', blending: 'normal', color: '#4a3b2c', puffs: chunks }
      ]
    }
  }
}

/** Rough extent (blocks, at scale 1) for the click box: [halfWidth, height]. */
export function vfxBounds(effect: VfxType): [number, number] {
  switch (effect) {
    case 'smoke':
      return [2, 8]
    case 'fog':
      return [7, 2]
    case 'fire':
      return [0.8, 2.2]
    case 'explosion':
      return [3.5, 6]
    case 'embers':
      return [2.5, 6]
    case 'magic':
      return [1.4, 2.8]
    case 'beam':
      return [1.6, 10]
    case 'totem':
      return [2.4, 3.6]
    case 'impact':
      return [3.2, 2]
  }
}
