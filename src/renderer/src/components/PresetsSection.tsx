// "My presets": blocks you saved from the timeline, to put on any character, and packs of them to share as files.
import { useState, type ReactNode } from 'react'
import { Bookmark, Download, Save, Trash2, Upload } from 'lucide-react'
import { applyPreset, saveAsPreset } from '../animation'
import { exportPresets, importPresets, removePreset, renamePreset, usePresets } from '../presetStore'
import { useStore } from '../store'
import { Group, Hint } from './controls'

export function PresetsSection({ objectId, clipId }: { objectId: string | null; clipId?: string }): ReactNode {
  const presets = usePresets((s) => s.presets)
  const hasBlocks = useStore((s) => {
    const tr = s.settings.animation?.tracks.find((t) => t.objectId === objectId)
    return !!tr?.clips?.length
  })
  const [editing, setEditing] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const say = (m: string): void => {
    setMessage(m)
    setTimeout(() => setMessage(null), 5000)
  }
  const wrap = (fn: () => Promise<void>) => (): void => {
    fn().catch((e: Error) => say(e.message))
  }

  return (
    <Group id="anim:presets" title="My presets" icon={<Bookmark size={15} />}>
      <div className="row">
        <button
          className="ghost"
          disabled={!objectId || !clipId}
          onClick={() => objectId && saveAsPreset(objectId, clipId)}
          title="Keep the selected block (with its path) to use again"
        >
          <Save size={14} /> Save block
        </button>
        <button
          className="ghost"
          disabled={!objectId || !hasBlocks}
          onClick={() => objectId && saveAsPreset(objectId)}
          title="Keep everything this character does, with the camera shots over it"
        >
          <Save size={14} /> Save all
        </button>
      </div>
      {presets.length ? (
        <div className="preset-list">
          {presets.map((p) => (
            <div key={p.id} className="preset-row">
              {editing === p.id ? (
                <input
                  autoFocus
                  defaultValue={p.name}
                  onBlur={(e) => {
                    renamePreset(p.id, e.target.value)
                    setEditing(null)
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') e.currentTarget.blur()
                    if (e.key === 'Escape') setEditing(null)
                  }}
                />
              ) : (
                <button
                  className="preset-name"
                  disabled={!objectId}
                  title={`${p.clips.length} block${p.clips.length === 1 ? '' : 's'}, ${p.duration.toFixed(1)} s. Click to add to the character; double-click to rename.`}
                  onClick={() => objectId && applyPreset(p, objectId)}
                  onDoubleClick={() => setEditing(p.id)}
                >
                  {p.name} <em>{p.duration.toFixed(1)} s</em>
                </button>
              )}
              <button
                className="icon-btn"
                title="Share this preset as a file"
                onClick={wrap(async () => void (await exportPresets(p.id)))}
              >
                <Download size={13} />
              </button>
              <button className="icon-btn" title="Delete this preset" onClick={() => removePreset(p.id)}>
                <Trash2 size={13} />
              </button>
            </div>
          ))}
        </div>
      ) : (
        <Hint>Save a block or a whole character's blocks, and it is here to add to anyone, anywhere.</Hint>
      )}
      <div className="row">
        <button
          className="ghost"
          onClick={wrap(async () => {
            const n = await importPresets()
            if (n) say(`Added ${n} preset${n === 1 ? '' : 's'}.`)
          })}
        >
          <Upload size={14} /> Open a pack
        </button>
        <button
          className="ghost"
          disabled={!presets.length}
          onClick={wrap(async () => {
            const path = await exportPresets()
            if (path) say('Saved the pack.')
          })}
        >
          <Download size={14} /> Save as a pack
        </button>
      </div>
      {message && <Hint>{message}</Hint>}
    </Group>
  )
}
