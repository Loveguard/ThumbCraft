// The resource pack list (Look tab): packs stack over the game's own textures like Minecraft's pack screen,
// the top one winning. The list is an app setting, so it applies to every project.
import { useEffect, useState, type ReactNode } from 'react'
import { ArrowDown, ArrowUp, FolderPlus, Package, Plus, X } from 'lucide-react'
import type { ResourcePackInfo } from '@shared/api'
import { useStore } from '../store'
import { errorText } from '../errors'
import { Hint } from './controls'

export function ResourcePacks(): ReactNode {
  const [packs, setPacks] = useState<ResourcePackInfo[]>([])
  const [busy, setBusy] = useState(false)
  const status = (m: string): void => useStore.getState().setStatus(m)
  useEffect(() => {
    window.blockframe.listResourcePacks().then(setPacks, () => undefined)
  }, [])

  /** Saves a new order / on-off state and redraws everything with the new textures. */
  const apply = async (next: ResourcePackInfo[]): Promise<void> => {
    setPacks(next)
    setBusy(true)
    try {
      const bundle = await window.blockframe.setResourcePacks(next.map(({ path, enabled }) => ({ path, enabled })))
      if (bundle) useStore.getState().setAssets(bundle)
      setPacks(await window.blockframe.listResourcePacks())
      const on = bundle?.packs ?? []
      status(on.length ? `Textures from ${on.join(', ')}` : 'Vanilla textures')
    } catch (e) {
      status(`Couldn't apply the resource packs: ${errorText(e)}`)
    } finally {
      setBusy(false)
    }
  }
  const add = async (folder: boolean): Promise<void> => {
    try {
      const list = await window.blockframe.addResourcePacks(folder)
      if (list.length !== packs.length) await apply(list)
    } catch (e) {
      status(errorText(e))
      setPacks(await window.blockframe.listResourcePacks())
    }
  }
  const move = (i: number, by: number): void => {
    const next = [...packs]
    const [p] = next.splice(i, 1)
    next.splice(i + by, 0, p)
    void apply(next)
  }

  return (
    <div className="packs">
      {packs.length === 0 && <p className="hint">No packs: the game&apos;s own textures are used.</p>}
      {packs.map((p, i) => (
        <div key={p.path} className={`pack ${p.enabled ? '' : 'off'} ${p.missing ? 'missing' : ''}`} title={p.path}>
          {p.icon ? <img src={p.icon} alt="" /> : <Package size={28} />}
          <div className="pack-text">
            <strong>{p.name}</strong>
            <span>{p.missing ? 'File not found' : p.description || `${p.textures} textures`}</span>
          </div>
          <div className="pack-actions">
            <input
              type="checkbox"
              role="switch"
              disabled={busy || p.missing}
              checked={p.enabled && !p.missing}
              title={p.enabled ? 'Turn off' : 'Turn on'}
              onChange={(e) => void apply(packs.map((x, k) => (k === i ? { ...x, enabled: e.target.checked } : x)))}
            />
            <button
              className="icon-btn sm"
              disabled={busy || i === 0}
              title="Higher (wins)"
              onClick={() => move(i, -1)}
            >
              <ArrowUp size={13} />
            </button>
            <button
              className="icon-btn sm"
              disabled={busy || i === packs.length - 1}
              title="Lower"
              onClick={() => move(i, 1)}
            >
              <ArrowDown size={13} />
            </button>
            <button
              className="icon-btn sm"
              disabled={busy}
              title="Remove from the list"
              onClick={() => void apply(packs.filter((_, k) => k !== i))}
            >
              <X size={13} />
            </button>
          </div>
        </div>
      ))}
      <div className="row-buttons">
        <button disabled={busy} onClick={() => void add(false)}>
          <Plus size={14} /> Add .zip
        </button>
        <button disabled={busy} onClick={() => void add(true)}>
          <FolderPlus size={14} /> Add folder
        </button>
      </div>
      <Hint>
        Packs replace block, item, mob, sky and font textures (and block models), like in game: the top pack wins. The
        list applies to every project; a project opened without the pack uses the game&apos;s textures.
      </Hint>
    </div>
  )
}
