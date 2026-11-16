import { useMemo, useState, type ReactNode } from 'react'
import { assetUrl } from '../../minecraft/assets'
import { groupParticles, keyFrame, type Particle } from '../../particleGroups'
import { placeNew } from '../../placement'
import { newId, useStore, type ImageObject } from '../../store'
import { Hint } from '../controls'

/** Every particle texture shipped in the user's client jar (textures/particle), grouped by look. */
/** The game's particle sprites (hearts, flames, notes…); `embedded` when shown inside another tab. */
export function ParticlesTab({ embedded = false }: { embedded?: boolean }): ReactNode {
  const assets = useStore((s) => s.assets)!
  const [filter, setFilter] = useState('')
  const [tint, setTint] = useState('#ffffff')
  // The animated particle added last: its frames are offered so the user can pick the one they want.
  const [last, setLast] = useState<{ id: string; particle: Particle } | null>(null)
  const categories = useMemo(() => {
    const f = filter.trim().toLowerCase()
    return groupParticles(assets.textures)
      .map((c) => ({
        ...c,
        particles: c.particles.filter(
          (p) => !f || p.label.toLowerCase().includes(f) || c.label.toLowerCase().includes(f)
        )
      }))
      .filter((c) => c.particles.length)
  }, [assets, filter])

  const add = (particle: Particle, path = keyFrame(particle)): void => {
    const url = assetUrl(path)
    const img = new Image()
    img.onload = () => {
      const id = newId('obj')
      useStore.getState().add({
        id,
        kind: 'image',
        name: `Particle: ${particle.label}`,
        url,
        aspect: img.width / img.height || 1,
        opacity: 1,
        onTop: false,
        pixelated: true,
        tint: tint === '#ffffff' ? undefined : tint,
        visible: true,
        ...placeNew('floating'),
        scale: 0.25
      })
      setLast(particle.frames.length > 1 ? { id, particle } : null)
    }
    img.src = url
  }

  /** Swaps the frame of the particle just added (or adds a new one if it was deleted). */
  const pickFrame = (path: string): void => {
    if (!last) return
    const o = useStore.getState().objects.find((x) => x.id === last.id)
    if (o?.kind === 'image') useStore.getState().update<ImageObject>(o.id, { url: assetUrl(path) })
    else add(last.particle, path)
  }
  const current = last && useStore.getState().objects.find((x) => x.id === last.id)

  return (
    <div className={embedded ? 'particles-embedded' : 'tab-body'}>
      <label className="field">
        <span>Search</span>
        <input value={filter} placeholder="heart, flame, explosion…" onChange={(e) => setFilter(e.target.value)} />
      </label>
      <label className="field">
        <span>Tint</span>
        <input type="color" value={tint} onChange={(e) => setTint(e.target.value)} />
        <button className="ghost" onClick={() => setTint('#ffffff')}>
          None
        </button>
      </label>
      {last && (
        <div className="particle-frames">
          <span className="label">{last.particle.label}: pick a frame</span>
          <div className="particle-grid small">
            {last.particle.frames.map((f) => (
              <button
                key={f}
                className={current?.kind === 'image' && current.url === assetUrl(f) ? 'active' : ''}
                onClick={() => pickFrame(f)}
              >
                <img src={assetUrl(f)} alt="" />
              </button>
            ))}
          </div>
        </div>
      )}
      {categories.map((c) => (
        <div key={c.label}>
          <h4>{c.label}</h4>
          <div className="particle-grid">
            {c.particles.map((p) => (
              <button key={p.name} title={p.label} onClick={() => add(p)}>
                <img src={assetUrl(keyFrame(p))} alt={p.label} loading="lazy" />
                {p.frames.length > 1 && <span className="frame-count">{p.frames.length}</span>}
              </button>
            ))}
          </div>
        </div>
      ))}
      {categories.length === 0 && <p className="hint">No particles match “{filter}”.</p>}
      <Hint>
        Particles from Minecraft {assets.version}. A number on a tile means it is animated: add it, then pick the frame
        you want. Grayscale ones (smoke, effects, dust…) are tinted in-game, so pick a tint for them.
      </Hint>
    </div>
  )
}
