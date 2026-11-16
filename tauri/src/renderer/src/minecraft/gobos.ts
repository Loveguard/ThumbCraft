// Spotlight patterns ("gobos"): images projected through a light. White lets light through, black blocks it,
// colours tint it. Drawn procedurally so nothing is copied from anywhere.
import * as THREE from 'three'

export const GOBOS: { id: string; label: string }[] = [
  { id: 'window', label: 'Window' },
  { id: 'blinds', label: 'Blinds' },
  { id: 'leaves', label: 'Leaves' },
  { id: 'stained', label: 'Stained glass' },
  { id: 'spot', label: 'Soft spot' }
]

const SIZE = 256

function draw(id: string, g: CanvasRenderingContext2D): void {
  g.fillStyle = '#000'
  g.fillRect(0, 0, SIZE, SIZE)
  switch (id) {
    case 'window': {
      // Four panes with a cross frame, inside a dark border.
      g.fillStyle = '#fff'
      const m = 36
      const bar = 14
      const pane = (SIZE - 2 * m - bar) / 2
      for (const x of [m, m + pane + bar]) for (const y of [m, m + pane + bar]) g.fillRect(x, y, pane, pane)
      break
    }
    case 'blinds': {
      g.fillStyle = '#fff'
      for (let y = 18; y < SIZE - 18; y += 22) g.fillRect(24, y, SIZE - 48, 12)
      break
    }
    case 'leaves': {
      // Dappled light: many soft blobs from a fixed seed, so the pattern is the same every time.
      let seed = 7
      const rnd = (): number => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646
      for (let i = 0; i < 70; i++) {
        const x = rnd() * SIZE
        const y = rnd() * SIZE
        const r = 6 + rnd() * 18
        const grad = g.createRadialGradient(x, y, 0, x, y, r)
        grad.addColorStop(0, 'rgba(255,255,255,0.95)')
        grad.addColorStop(1, 'rgba(255,255,255,0)')
        g.fillStyle = grad
        g.fillRect(x - r, y - r, r * 2, r * 2)
      }
      break
    }
    case 'stained': {
      const colors = ['#e84a4a', '#f2c443', '#4a8de8', '#5fd16b', '#b45fe0', '#f28c3a']
      const n = 4
      const m = 24
      const cell = (SIZE - 2 * m) / n
      for (let i = 0; i < n; i++)
        for (let j = 0; j < n; j++) {
          g.fillStyle = colors[(i * 3 + j * 5) % colors.length]
          g.fillRect(m + i * cell + 4, m + j * cell + 4, cell - 8, cell - 8)
        }
      break
    }
    case 'spot':
    default: {
      const grad = g.createRadialGradient(SIZE / 2, SIZE / 2, 0, SIZE / 2, SIZE / 2, SIZE / 2)
      grad.addColorStop(0, '#fff')
      grad.addColorStop(0.6, '#fff')
      grad.addColorStop(1, '#000')
      g.fillStyle = grad
      g.fillRect(0, 0, SIZE, SIZE)
    }
  }
}

const cache = new Map<string, THREE.Texture>()

/** Texture for a built-in gobo. Shared between lights; never disposed. */
export function goboTexture(id: string): THREE.Texture {
  let t = cache.get(id)
  if (!t) {
    const c = document.createElement('canvas')
    c.width = c.height = SIZE
    draw(id, c.getContext('2d')!)
    t = new THREE.CanvasTexture(c)
    t.colorSpace = THREE.SRGBColorSpace
    cache.set(id, t)
  }
  return t
}

/** Small preview image for the picker. */
export function goboPreview(id: string): string {
  return (goboTexture(id).image as HTMLCanvasElement).toDataURL()
}
