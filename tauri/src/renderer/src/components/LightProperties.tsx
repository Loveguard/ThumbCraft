import { useRef, type ReactNode } from 'react'
import { Upload } from 'lucide-react'
import { GOBOS, goboPreview } from '../minecraft/gobos'
import { mediaStore, registerFile } from '../media'
import { useStore, type LightObject } from '../store'
import { Slider } from './controls'
import { isLit } from '../renderModes'

export function LightProperties({ o }: { o: LightObject }): ReactNode {
  const renderMode = useStore((s) => s.settings.renderMode)
  const { update, setSettings } = useStore.getState()
  const set = (patch: Partial<LightObject>): void => update(o.id, patch)
  const file = useRef<HTMLInputElement>(null)
  const custom = o.goboMediaId ? mediaStore.get(o.goboMediaId) : undefined
  const patterned = o.lightType === 'spot' && !!o.gobo

  const slider = (
    label: string,
    key: 'intensity' | 'range' | 'angle' | 'softness',
    min: number,
    max: number,
    step: number,
    fmt: (v: number) => string
  ): ReactNode => (
    <Slider
      label={label}
      min={min}
      max={max}
      step={step}
      value={o[key]}
      format={fmt}
      onChange={(v) => set({ [key]: v })}
    />
  )

  return (
    <>
      <h4>Light</h4>
      {!isLit(renderMode) && (
        <p className="warn">
          Lights only show in Cinematic mode.{' '}
          <button className="link" onClick={() => setSettings({ renderMode: 'cinematic' })}>
            Switch
          </button>
        </p>
      )}
      <div className="segmented">
        {(['point', 'spot'] as const).map((t) => (
          <button key={t} className={o.lightType === t ? 'active' : ''} onClick={() => set({ lightType: t })}>
            {t === 'point' ? 'Point' : 'Spotlight'}
          </button>
        ))}
      </div>
      <label className="field">
        <span>Colour</span>
        <input type="color" value={o.color} onChange={(e) => set({ color: e.target.value })} />
      </label>
      {slider('Brightness', 'intensity', 0, o.lightType === 'spot' ? 600 : 150, 1, (v) => `${v}`)}
      {slider('Reach', 'range', 0, 80, 1, (v) => (v === 0 ? '∞' : `${v} m`))}
      {o.lightType === 'spot' && (
        <>
          {slider('Cone', 'angle', 5, 120, 1, (v) => `${v}°`)}
          {slider('Soft edge', 'softness', 0, 1, 0.05, (v) => `${Math.round(v * 100)}%`)}
        </>
      )}
      <label className="check">
        <input
          type="checkbox"
          checked={o.shadows || patterned}
          disabled={patterned}
          onChange={(e) => set({ shadows: e.target.checked })}
        />
        <span>Cast shadows{patterned ? ' (needed for patterns)' : ''}</span>
      </label>

      {o.lightType === 'spot' && (
        <>
          <h4>Pattern</h4>
          <div className="gobo-grid">
            <button className={`gobo ${!o.gobo ? 'active' : ''}`} onClick={() => set({ gobo: null })}>
              <span className="gobo-none" />
              None
            </button>
            {GOBOS.map((g) => (
              <button
                key={g.id}
                className={`gobo ${o.gobo === g.id ? 'active' : ''}`}
                onClick={() => set({ gobo: g.id })}
              >
                <img src={goboPreview(g.id)} alt="" />
                {g.label}
              </button>
            ))}
            <button
              className={`gobo ${o.gobo === 'custom' ? 'active' : ''}`}
              title="Any image: white lets light through, black blocks it, colours tint it"
              onClick={() => (custom && o.gobo !== 'custom' ? set({ gobo: 'custom' }) : file.current?.click())}
            >
              {custom ? <img src={custom.url} alt="" /> : <Upload size={18} />}
              {custom ? 'Yours' : 'Your image…'}
            </button>
          </div>
          <input
            ref={file}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            hidden
            onChange={async (e) => {
              const f = e.target.files?.[0]
              if (!f) return
              e.target.value = ''
              const m = await registerFile(f)
              if (m) set({ gobo: 'custom', goboMediaId: m.id })
            }}
          />
        </>
      )}
    </>
  )
}
