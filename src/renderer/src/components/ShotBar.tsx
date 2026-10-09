import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Columns2, Download, MoreHorizontal, Plus, X } from 'lucide-react'
import { captureSplit } from '../capture'
import { encodeExport, extensionOf } from '../exportImage'
import { inShot, MAX_SHOTS, shotLabel, useStore, type CarryOver, type SplitSettings } from '../store'
import { Slider } from './controls'
import { KIND_ICON } from './RightPanel'

const CHOICES: { id: CarryOver; label: string; hint: string }[] = [
  { id: 'copy', label: 'Copy', hint: 'Its own copy in the new shot: editing one never changes the other' },
  { id: 'link', label: 'Link', hint: 'The same layer in both shots: an edit in one shows in both' },
  { id: 'skip', label: 'Leave out', hint: 'Not in the new shot' }
]

/** Closes a popover when the pointer goes down anywhere outside it. */
function useOutside(ref: React.RefObject<HTMLElement | null>, onClose: () => void): void {
  useEffect(() => {
    const away = (e: MouseEvent): void => {
      // The whole shot bar counts as inside, so its own buttons toggle the popover instead of reopening it.
      const inside = ref.current?.closest('.shot-bar') ?? ref.current
      if (inside && !inside.contains(e.target as Node)) onClose()
    }
    window.addEventListener('mousedown', away)
    return () => window.removeEventListener('mousedown', away)
  }, [ref, onClose])
}

/** "What carries over?": every layer of the current shot, copied (default), linked or left out of the new one. */
function NewShotDialog({ onClose }: { onClose: () => void }): ReactNode {
  const objects = useStore((s) => s.objects)
  const shots = useStore((s) => s.shots)
  const activeShot = useStore((s) => s.activeShot)
  const layers = [...objects].reverse().filter((o) => inShot(o, activeShot))
  const [carry, setCarry] = useState<Record<string, CarryOver>>({})
  const ref = useRef<HTMLDivElement>(null)
  useOutside(ref, onClose)
  const how = (id: string): CarryOver => carry[id] ?? 'copy'
  const next = String.fromCharCode(65 + shots.length)
  return (
    <div className="new-shot" role="dialog" ref={ref}>
      <div className="new-shot-head">
        <strong>New shot {next}</strong>
        <span>
          Starts from shot {shotLabel(shots, activeShot)}'s camera. Choose what comes along; you can change it later
          with the A/B/C chips in Layers.
        </span>
      </div>
      <div className="new-shot-all">
        <span>Everything</span>
        <div className="segmented sm">
          {CHOICES.map((c) => (
            <button
              key={c.id}
              title={c.hint}
              className={layers.every((o) => how(o.id) === c.id) ? 'active' : ''}
              onClick={() => setCarry(Object.fromEntries(layers.map((o) => [o.id, c.id])))}
            >
              {c.label}
            </button>
          ))}
        </div>
      </div>
      <ul className="new-shot-list">
        {layers.map((o) => {
          const Icon = KIND_ICON[o.kind]
          return (
            <li key={o.id}>
              <Icon size={14} className="kind" />
              <span className="name">{o.name}</span>
              <div className="segmented sm">
                {CHOICES.map((c) => (
                  <button
                    key={c.id}
                    title={c.hint}
                    className={how(o.id) === c.id ? 'active' : ''}
                    onClick={() => setCarry((prev) => ({ ...prev, [o.id]: c.id }))}
                  >
                    {c.label}
                  </button>
                ))}
              </div>
            </li>
          )
        })}
      </ul>
      <div className="row">
        <button className="ghost" onClick={onClose}>
          Cancel
        </button>
        <button
          className="primary"
          onClick={() => {
            useStore.getState().addShot(Object.fromEntries(layers.map((o) => [o.id, how(o.id)])))
            useStore
              .getState()
              .setStatus(`Shot ${next} added. Move the camera and change what you like; shot A stays as it was.`)
            onClose()
          }}
        >
          Create shot {next}
        </button>
      </div>
    </div>
  )
}

/** The current shot's options: its own look, or delete it. */
function ShotMenu({ onClose }: { onClose: () => void }): ReactNode {
  const shots = useStore((s) => s.shots)
  const activeShot = useStore((s) => s.activeShot)
  const own = !!shots.find((x) => x.id === activeShot)?.look
  const label = shotLabel(shots, activeShot)
  const ref = useRef<HTMLDivElement>(null)
  useOutside(ref, onClose)
  const { setShotOwnLook, removeShot } = useStore.getState()
  return (
    <div className="shot-menu" role="menu" ref={ref}>
      <label className="check">
        <input type="checkbox" checked={own} onChange={(e) => setShotOwnLook(e.target.checked)} />
        <span>
          Shot {label} has its own look
          <em>Colour, effects, sky and render mode just for this shot</em>
        </span>
      </label>
      {shots.length > 1 && (
        <button
          className="danger"
          onClick={() => {
            removeShot(activeShot)
            useStore.getState().setStatus(`Shot ${label} deleted (Ctrl+Z brings it back).`)
            onClose()
          }}
        >
          <X size={14} /> Delete shot {label}
        </button>
      )}
    </div>
  )
}

const DIVIDERS: { id: SplitSettings['style']; label: string }[] = [
  { id: 'straight', label: 'Straight' },
  { id: 'torn', label: 'Torn paper' },
  { id: 'lightning', label: 'Lightning' }
]

/** Two shots side by side in one image ("Day 1 vs Day 100"): pick the shots and the divider, preview, export. */
function SplitMenu({ onClose }: { onClose: () => void }): ReactNode {
  const shots = useStore((s) => s.shots)
  const saved = useStore((s) => s.settings.split)
  const ref = useRef<HTMLDivElement>(null)
  useOutside(ref, onClose)
  const valid = (id?: string): boolean => !!id && shots.some((x) => x.id === id)
  const sp: SplitSettings = {
    style: 'torn',
    angle: 8,
    position: 0.5,
    color: '#ffd23a',
    ...saved,
    left: valid(saved?.left) ? saved!.left : shots[0].id,
    right: valid(saved?.right) ? saved!.right : shots[1].id
  }
  const set = (patch: Partial<SplitSettings>): void => useStore.getState().setSettings({ split: { ...sp, ...patch } })
  const [preview, setPreview] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const render = async (): Promise<void> => {
    setBusy(true)
    try {
      setPreview(await captureSplit(640, 360, sp))
    } finally {
      setBusy(false)
    }
  }
  const exportIt = async (): Promise<void> => {
    const s = useStore.getState()
    const { exportWidth: w, exportHeight: h, exportFormat } = s.settings
    setBusy(true)
    try {
      const url = await encodeExport(await captureSplit(w, h, sp), exportFormat)
      const name = `${s.project.name} - Split ${shotLabel(shots, sp.left)}-${shotLabel(shots, sp.right)}`
      const file = await window.blockframe.savePng(url, `${name}.${extensionOf(exportFormat)}`)
      if (file) s.setStatus(`Exported ${file}`)
    } finally {
      setBusy(false)
    }
  }
  const pick = (side: 'left' | 'right'): ReactNode => (
    <div className="segmented sm">
      {shots.map((x) => (
        <button key={x.id} className={sp[side] === x.id ? 'active' : ''} onClick={() => set({ [side]: x.id })}>
          {shotLabel(shots, x.id)}
        </button>
      ))}
    </div>
  )
  return (
    <div className="shot-menu split-menu" role="dialog" ref={ref}>
      <strong>Split image</strong>
      <div className="split-row">
        <span>Left</span>
        {pick('left')}
      </div>
      <div className="split-row">
        <span>Right</span>
        {pick('right')}
      </div>
      <div className="segmented">
        {DIVIDERS.map((d) => (
          <button key={d.id} className={sp.style === d.id ? 'active' : ''} onClick={() => set({ style: d.id })}>
            {d.label}
          </button>
        ))}
      </div>
      <Slider
        label="Lean"
        min={-30}
        max={30}
        step={1}
        value={sp.angle}
        format={(v) => `${v}°`}
        onChange={(angle) => set({ angle })}
      />
      <Slider
        label="Position"
        min={0.2}
        max={0.8}
        step={0.01}
        value={sp.position}
        format={(v) => `${Math.round(v * 100)}%`}
        onChange={(position) => set({ position })}
      />
      {sp.style !== 'torn' && (
        <label className="field">
          <span>Colour</span>
          <input type="color" value={sp.color} onChange={(e) => set({ color: e.target.value })} />
        </label>
      )}
      {preview && <img className="split-preview" src={preview} alt="Split preview" />}
      <div className="row">
        <button disabled={busy} onClick={() => void render()}>
          {preview ? 'Update preview' : 'Preview'}
        </button>
        <button className="primary" disabled={busy} onClick={() => void exportIt()}>
          <Download size={14} /> Export split
        </button>
      </div>
    </div>
  )
}

/**
 * Shots A/B/C above the viewport: up to three versions of the thumbnail (for YouTube's Test & Compare), each with
 * its own camera and layers. Keys 1–3 switch between them.
 */
export function ShotBar(): ReactNode {
  const shots = useStore((s) => s.shots)
  const activeShot = useStore((s) => s.activeShot)
  const [dialog, setDialog] = useState(false)
  const [menu, setMenu] = useState(false)
  const [split, setSplit] = useState(false)
  const { switchShot } = useStore.getState()
  return (
    <div className="float-bar shot-bar">
      <span className="shot-bar-label">Shot</span>
      {shots.map((sh, i) => (
        <button
          key={sh.id}
          className={`shot-tab ${sh.id === activeShot ? 'active' : ''}`}
          title={`Shot ${shotLabel(shots, sh.id)} (${i + 1})${sh.look ? ' · own look' : ''}`}
          onClick={() => switchShot(sh.id)}
        >
          {shotLabel(shots, sh.id)}
          {sh.look && <i className="shot-own-look" />}
        </button>
      ))}
      {shots.length < MAX_SHOTS && (
        <button
          className="shot-tab add"
          title="Add a shot: another version to compare (YouTube tests up to 3)"
          onClick={() => setDialog(true)}
        >
          <Plus size={14} />
        </button>
      )}
      {shots.length > 1 && (
        <button
          className={`shot-tab ${split ? 'active' : ''}`}
          title="Split image: two shots side by side (Day 1 vs Day 100)"
          onClick={() => setSplit(!split)}
        >
          <Columns2 size={14} />
        </button>
      )}
      <button className="shot-tab" title="This shot's options" onClick={() => setMenu(!menu)}>
        <MoreHorizontal size={14} />
      </button>
      {dialog && <NewShotDialog onClose={() => setDialog(false)} />}
      {menu && <ShotMenu onClose={() => setMenu(false)} />}
      {split && <SplitMenu onClose={() => setSplit(false)} />}
    </div>
  )
}
