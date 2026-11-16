import type { ReactNode } from 'react'
import { mediaStore } from '../media'
import { useStore, type TextObject } from '../store'
import { customFamily, FONTS, TEXT_STYLES } from '../textStyles'
import { Group, Slider, Toggle } from './controls'
import { FontPicker } from './FontPicker'

export function TextProperties({ o }: { o: TextObject }): ReactNode {
  const set = (patch: Partial<TextObject>): void => useStore.getState().update(o.id, patch)
  // Fonts imported anywhere in this project, so a second title can reuse them.
  const imported = useStore((s) => {
    const ids = new Set<string>()
    for (const x of s.objects) if (x.kind === 'text' && x.fontMediaId) ids.add(x.fontMediaId)
    return [...ids].join('|')
  })
  const importedFonts = imported ? imported.split('|').filter((id) => mediaStore.has(id)) : []
  const fontValue = o.fontMediaId ? `media:${o.fontMediaId}` : o.font
  const fontLabel = o.fontMediaId
    ? (mediaStore.get(o.fontMediaId)?.name.replace(/\.[^.]+$/, '') ?? 'Imported font')
    : (FONTS.find((f) => f.family === o.font)?.label ?? o.font.split(',')[0].replace(/"/g, ''))

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
      <div className="field">
        <span>Font</span>
        <FontPicker
          value={fontValue}
          label={fontLabel}
          imported={importedFonts.map((id) => ({
            value: `media:${id}`,
            label: mediaStore.get(id)!.name.replace(/\.[^.]+$/, ''),
            css: customFamily(id)
          }))}
          onPick={(v) => {
            if (v.startsWith('media:')) set({ fontMediaId: v.slice(6) })
            else set({ font: v, fontMediaId: undefined })
          }}
          onFile={(fontMediaId) => set({ fontMediaId })}
        />
      </div>
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
