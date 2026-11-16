// The Custom look: the lighting behind Cinematic, Soft and Cartoon, opened up for tuning, and saved to a small
// file to reuse in other projects or share. (Real shader packs are GLSL for the game's own renderer.)
import { useRef, type ReactNode } from 'react'
import { Download, Upload } from 'lucide-react'
import { useStore } from '../store'
import { LIGHTING, lightingOf, parseLighting, type Lighting } from '../renderModes'
import { Slider } from './controls'

const START: { id: keyof typeof LIGHTING; label: string }[] = [
  { id: 'cinematic', label: 'Cinematic' },
  { id: 'soft', label: 'Soft' },
  { id: 'cartoon', label: 'Cartoon' }
]

export function CustomLighting(): ReactNode {
  const custom = useStore((s) => s.settings.customLighting)
  const l = lightingOf('custom', custom)!
  const set = (patch: Partial<Lighting>): void =>
    useStore.getState().setSettings({ customLighting: { ...l, ...patch } })
  const file = useRef<HTMLInputElement>(null)
  const status = (m: string): void => useStore.getState().setStatus(m)

  const color = (k: 'sunColor' | 'skyColor' | 'groundColor', label: string): ReactNode => (
    <label className="field">
      <span>{label}</span>
      <input type="color" value={l[k]} onChange={(e) => set({ [k]: e.target.value })} />
    </label>
  )
  return (
    <div className="custom-lighting">
      <div className="field">
        <span>Start from</span>
        <div className="segmented small">
          {START.map((s) => (
            <button key={s.id} onClick={() => set(LIGHTING[s.id])}>
              {s.label}
            </button>
          ))}
        </div>
      </div>
      <div className="color-slider">
        <input type="color" value={l.sunColor} onChange={(e) => set({ sunColor: e.target.value })} />
        <Slider label="Sun" min={0} max={5} step={0.05} value={l.sun} onChange={(sun) => set({ sun })} />
      </div>
      <Slider label="Ambient" min={0} max={3} step={0.05} value={l.ambient} onChange={(ambient) => set({ ambient })} />
      <Slider
        label="Sky bounce"
        title="Light from the sky above and the ground below, which shader packs use to colour the shade"
        min={0}
        max={3}
        step={0.05}
        value={l.hemisphere}
        onChange={(hemisphere) => set({ hemisphere })}
      />
      {l.hemisphere > 0 && (
        <>
          {color('skyColor', 'Sky light')}
          {color('groundColor', 'Ground light')}
        </>
      )}
      <Slider
        label="Fill"
        title="The faint second light that keeps the far side of things from going black"
        min={0}
        max={2}
        step={0.02}
        value={l.fill}
        onChange={(fill) => set({ fill })}
      />
      <Slider
        label="Shadow softness"
        min={0}
        max={15}
        step={0.5}
        value={l.shadowSoftness}
        onChange={(shadowSoftness) => set({ shadowSoftness })}
      />
      <div className="row-buttons">
        <button
          title="Save this lighting to a file, to use it in other projects or share it"
          onClick={() => {
            const blob = new Blob([JSON.stringify({ thumbcraftLighting: l }, null, 2)], { type: 'application/json' })
            const a = document.createElement('a')
            a.href = URL.createObjectURL(blob)
            a.download = 'lighting.tclight.json'
            a.click()
            setTimeout(() => URL.revokeObjectURL(a.href), 10_000)
          }}
        >
          <Download size={14} /> Save look
        </button>
        <button title="Load lighting saved from ThumbCraft" onClick={() => file.current?.click()}>
          <Upload size={14} /> Load look
        </button>
        <input
          ref={file}
          type="file"
          accept=".json"
          hidden
          onChange={async (e) => {
            const f = e.target.files?.[0]
            e.target.value = ''
            if (!f) return
            try {
              const lighting = parseLighting(JSON.parse(await f.text()))
              if (!lighting) return status(`${f.name} isn't a ThumbCraft lighting file`)
              useStore.getState().setSettings({ customLighting: lighting })
              status(`Loaded lighting from ${f.name}`)
            } catch {
              status(`${f.name} isn't a ThumbCraft lighting file`)
            }
          }}
        />
      </div>
    </div>
  )
}
