import { useRef, type ReactNode } from 'react'
import { Upload } from 'lucide-react'
import { mediaStore, registerFile } from '../media'
import { useStore, type TextObject } from '../store'
import { FONTS, TEXT_STYLES } from '../textStyles'
import { Group, Slider, Toggle } from './controls'

const FONT_FILES = '.ttf,.otf,.woff,.woff2'

export function TextProperties({ o }: { o: TextObject }): ReactNode {
  const set = (patch: Partial<TextObject>): void => useStore.getState().update(o.id, patch)
  const file = useRef<HTMLInputElement>(null)
  // Fonts imported anywhere in this project, so a second title can reuse them.
  const imported = useStore((s) => {
    const ids = new Set<string>()
    for (const x of s.objects) if (x.kind === 'text' && x.fontMediaId) ids.add(x.fontMediaId)
    return [...ids].join('|')
  })
  const importedFonts = imported ? imported.split('|').filter((id) => mediaStore.has(id)) : []
  const fontValue = o.fontMediaId ? `media:${o.fontMediaId}` : o.font
  const known = FONTS.some((f) => f.family === o.font)

  return (
    <>
      <label className="field col">
        <span>Text</span>
        <textarea rows={2} value={o.text} onChange={(e) => set({ text: e.target.value })} />
      </label>
      <div className="field col">
        <span>Style</span>
        <div className="text-styles">
          {TEXT_STYLES.map((t) => (
            <button key={t.name} title={t.name} onClick={() => set(t.style)}>
              <i style={{ background: t.preview }} />
              {t.name}
            </button>
          ))}
        </div>
      </div>
      <label className="field">
        <span>Font</span>
        <select
          value={fontValue}
          onChange={(e) => {
            const v = e.target.value
            if (v.startsWith('media:')) set({ fontMediaId: v.slice(6) })
            else set({ font: v, fontMediaId: undefined })
          }}
        >
          {FONTS.map((f) => (
            <option key={f.label} value={f.family}>
              {f.label}
            </option>
          ))}
          {!known && !o.fontMediaId && <option value={o.font}>{o.font.split(',')[0].replace(/"/g, '')}</option>}
          {importedFonts.map((id) => (
            <option key={id} value={`media:${id}`}>
              {mediaStore.get(id)!.name.replace(/\.[^.]+$/, '')}
            </option>
          ))}
        </select>
        <button
          className="icon-btn sm"
          title="Import a font file (.ttf, .otf, .woff)"
          onClick={() => file.current?.click()}
        >
          <Upload size={14} />
        </button>
        <input
          ref={file}
          type="file"
          accept={FONT_FILES}
          hidden
          onChange={async (e) => {
            const f = e.target.files?.[0]
            e.target.value = ''
            if (!f) return
            const media = await registerFile(f)
            if (media) set({ fontMediaId: media.id })
          }}
        />
      </label>
      <label className="field">
        <span>Fill</span>
        <input type="color" value={o.color} onChange={(e) => set({ color: e.target.value })} />
        <label className="check inline" title="Fade the fill into a second colour towards the bottom">
          <input
            type="checkbox"
            checked={!!o.gradient}
            onChange={(e) => set({ gradient: e.target.checked ? '#ff6a00' : null })}
          />
          <span>Fade to</span>
        </label>
        {o.gradient && <input type="color" value={o.gradient} onChange={(e) => set({ gradient: e.target.value })} />}
      </label>
      <Group id="text-outline" title="Outline, glow & shadow">
        <div className="color-slider">
          <input type="color" value={o.outlineColor} onChange={(e) => set({ outlineColor: e.target.value })} />
          <Slider
            label="Outline"
            min={0}
            max={40}
            value={o.outlineWidth}
            onChange={(outlineWidth) => set({ outlineWidth })}
          />
        </div>
        <div className="color-slider">
          <input
            type="color"
            value={o.outline2Color ?? '#000000'}
            onChange={(e) => set({ outline2Color: e.target.value })}
          />
          <Slider
            label="Outer outline"
            title="A second outline around the first"
            min={0}
            max={30}
            value={o.outline2Width ?? 0}
            onChange={(outline2Width) => set({ outline2Width })}
          />
        </div>
        <div className="color-toggle">
          <Toggle label="Glow" checked={!!o.glow} onChange={(on) => set({ glow: on ? '#ffd23f' : null })} />
          {o.glow && <input type="color" value={o.glow} onChange={(e) => set({ glow: e.target.value })} />}
        </div>
        <Toggle label="Drop shadow" checked={o.shadow} onChange={(shadow) => set({ shadow })} />
      </Group>
      <Toggle label="Always on top (overlay)" checked={o.onTop} onChange={(onTop) => set({ onTop })} />
    </>
  )
}
