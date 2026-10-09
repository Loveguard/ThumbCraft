import type { ReactNode } from 'react'
import { FlipHorizontal2 } from 'lucide-react'
import { useStore, type StickerObject } from '../store'
import { hasWeight, STICKER_SWATCHES, STICKERS, stickerSvg, stretchLabel } from '../stickers'
import { Hint, Slider, Toggle } from './controls'

export function StickerProperties({ o }: { o: StickerObject }): ReactNode {
  const set = (patch: Partial<StickerObject>): void => useStore.getState().update(o.id, patch)
  const stretch = stretchLabel(o.shape)
  return (
    <>
      <div className="sticker-grid">
        {STICKERS.map((s) => (
          <button
            key={s.id}
            title={s.label}
            className={o.shape === s.id ? 'active' : ''}
            onClick={() => set({ shape: s.id })}
            dangerouslySetInnerHTML={{ __html: stickerSvg({ ...o, shape: s.id }) }}
          />
        ))}
      </div>
      <div className="field">
        <span>Colour</span>
        <div className="swatches">
          {STICKER_SWATCHES.map((c) => (
            <button
              key={c}
              className={`swatch ${o.color.toLowerCase() === c ? 'active' : ''}`}
              aria-label={c}
              style={{ background: c }}
              onClick={() => set({ color: c })}
            />
          ))}
          <input type="color" value={o.color} onChange={(e) => set({ color: e.target.value })} />
        </div>
      </div>
      <Slider
        label="Size"
        min={0.05}
        max={0.9}
        step={0.01}
        value={o.scale}
        format={(v) => `${Math.round(v * 100)}%`}
        onChange={(scale) => set({ scale })}
      />
      {hasWeight(o.shape) && (
        <Slider
          label="Thickness"
          min={0.3}
          max={3}
          step={0.05}
          value={o.weight ?? 1}
          format={(v) => `${Math.round(v * 100)}%`}
          onChange={(weight) => set({ weight })}
        />
      )}
      {stretch && (
        <Slider
          label={stretch}
          min={0.4}
          max={3}
          step={0.05}
          value={o.stretch ?? 1}
          format={(v) => `${Math.round(v * 100)}%`}
          onChange={(v) => set({ stretch: v })}
        />
      )}
      <Slider
        label="Turn"
        min={-180}
        max={180}
        step={1}
        value={o.rotation[2]}
        format={(v) => `${Math.round(v)}°`}
        onChange={(r) => set({ rotation: [0, 0, r] })}
      />
      <Toggle label="White outline" checked={o.outline} onChange={(outline) => set({ outline })} />
      <Toggle label="Glow in its colour" checked={o.glow} onChange={(glow) => set({ glow })} />
      <button onClick={() => set({ flip: !o.flip })}>
        <FlipHorizontal2 size={15} /> Mirror
      </button>
      <Hint>
        Drag it in the viewport to move it; drag the corner dot to resize, the top dot to turn it and, on arrows,
        circles and boxes, the side dot to stretch it. Stickers sit on the frame itself, on top of every effect, and
        stay put when the camera moves.
      </Hint>
    </>
  )
}
