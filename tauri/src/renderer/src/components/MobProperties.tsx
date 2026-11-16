import { Group, NumberRow } from './controls'
import { useEffect, useState, type ReactNode } from 'react'
import { mainParts, mobPosePresets, partPaths, textureCandidates, type MobModels } from '@shared/minecraft/entityModels'
import { mobModels } from '../minecraft/mobs'
import { useStore, type MobObject } from '../store'

export function MobProperties({ o }: { o: MobObject }): ReactNode {
  const [models, setModels] = useState<MobModels | null>(null)
  const update = useStore((s) => s.update)
  useEffect(() => {
    void mobModels().then(setModels, () => undefined)
  }, [])
  const layer = models?.layers[o.layer]
  if (!models || !layer) return null
  const candidates = textureCandidates(o.layer, layer, models.textureSizes)
  // Always allow any entity texture with matching proportions, best guesses first.
  const others = Object.entries(models.textureSizes)
    .filter(([p, [w, h]]) => w * layer.texture[1] === h * layer.texture[0] && !candidates.includes(p))
    .map(([p]) => p)
    .sort()
  const set = (patch: Partial<MobObject>): void => update(o.id, patch)
  const paths = partPaths(layer.root)
  const main = mainParts(paths)
  const presets = mobPosePresets(paths)
  const row = (path: string): ReactNode => (
    <NumberRow
      key={path}
      label={path.split('/').pop()!.replace(/_/g, ' ')}
      step={1}
      digits={0}
      suffix="°"
      value={o.partRotations[path] ?? [0, 0, 0]}
      onChange={(v) => set({ partRotations: { ...o.partRotations, [path]: v } })}
    />
  )
  return (
    <>
      <label className="field">
        <span>Texture</span>
        <select value={o.texture} onChange={(e) => set({ texture: e.target.value })}>
          {[...candidates, ...others].map((p) => (
            <option key={p} value={p}>
              {p.replace(/^entity\//, '')}
            </option>
          ))}
        </select>
      </label>
      <h4>Pose</h4>
      <div className="chips">
        <button
          className={`chip ${Object.keys(o.partRotations).length === 0 ? 'active' : ''}`}
          onClick={() => set({ partRotations: {} })}
        >
          Default
        </button>
        {presets.map((p) => (
          <button
            key={p.label}
            className="chip"
            title="Adds to the current pose; Default clears it"
            onClick={() => set({ partRotations: { ...o.partRotations, ...p.rotations } })}
          >
            {p.label}
          </button>
        ))}
      </div>
      {main.length > 0 && (
        <Group id="mob-main-parts" title="Main parts" defaultOpen>
          {main.map((path) => row(path))}
        </Group>
      )}
      <Group id="mob-all-parts" title={`All parts (${paths.length})`}>
        {paths.map((path) => row(path))}
      </Group>
    </>
  )
}
