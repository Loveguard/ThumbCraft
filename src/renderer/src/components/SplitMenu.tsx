import { useRef, useState, type ReactNode } from 'react'
import { Columns2, Download } from 'lucide-react'
import { captureSplit } from '../capture'
import { encodeExport, extensionOf, reportExportError } from '../exportImage'
import { useStore, type SplitSettings } from '../store'
import { tabProject, useTabs } from '../tabs'
import { Slider } from './controls'
import { useDismiss } from '../useDismiss'

const DIVIDERS: { id: SplitSettings['style']; label: string }[] = [
  { id: 'straight', label: 'Straight' },
  { id: 'torn', label: 'Torn paper' },
  { id: 'lightning', label: 'Lightning' }
]

/** Two open projects side by side in one image ("Day 1 vs Day 100"): pick them and the divider, preview, export. */
function SplitMenu({ onClose }: { onClose: () => void }): ReactNode {
  const tabs = useTabs((s) => s.tabs)
  const active = useTabs((s) => s.active)
  const saved = useStore((s) => s.settings.split)
  const ref = useRef<HTMLDivElement>(null)
  useDismiss(ref, onClose, (el) => el.closest('.tab-bar-end'))
  const valid = (key?: string): boolean => !!key && tabs.some((t) => t.key === key)
  // By default: this project on the left, the next one on the right.
  const other = tabs.find((t) => t.key !== active)?.key ?? active
  const sp: SplitSettings = {
    style: 'torn',
    angle: 8,
    position: 0.5,
    color: '#ffd23a',
    ...saved,
    left: valid(saved?.left) ? saved!.left : active,
    right: valid(saved?.right) ? saved!.right : other
  }
  const set = (patch: Partial<SplitSettings>): void => useStore.getState().setSettings({ split: { ...sp, ...patch } })
  const [preview, setPreview] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const nameOf = (key: string): string => {
    const t = tabs.find((x) => x.key === key)
    return t ? tabProject(t).name : '?'
  }
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
      const name = `${nameOf(sp.left)} vs ${nameOf(sp.right)}`
      const file = await window.blockframe.savePng(url, `${name}.${extensionOf(exportFormat)}`)
      if (file) useStore.getState().setStatus(`Exported ${file}`)
    } catch (e) {
      reportExportError(e)
    } finally {
      setBusy(false)
    }
  }
  const pick = (side: 'left' | 'right'): ReactNode => (
    <select value={sp[side]} onChange={(e) => set({ [side]: e.target.value })}>
      {tabs.map((t) => (
        <option key={t.key} value={t.key}>
          {tabProject(t).name}
        </option>
      ))}
    </select>
  )
  return (
    <div className="pop-menu split-menu" role="dialog" ref={ref}>
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
          {busy ? 'Rendering…' : preview ? 'Update preview' : 'Preview'}
        </button>
        <button className="primary" disabled={busy} onClick={() => void exportIt()}>
          <Download size={14} /> Export split
        </button>
      </div>
    </div>
  )
}

/** The tab bar's "Split image" button and its menu. */
export function SplitButton(): ReactNode {
  const [open, setOpen] = useState(false)
  return (
    <div className="tab-bar-end">
      <button
        className={`tab-add ${open ? 'active' : ''}`}
        title="Split image: two open projects side by side (Day 1 vs Day 100)"
        onClick={() => setOpen(!open)}
      >
        <Columns2 size={14} /> Split image
      </button>
      {open && <SplitMenu onClose={() => setOpen(false)} />}
    </div>
  )
}
