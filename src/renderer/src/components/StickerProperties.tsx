import type { ReactNode } from 'react'
import { FlipHorizontal2 } from 'lucide-react'
import { useStore, type StickerObject } from '../store'
import { STICKER_SWATCHES, STICKERS, stickerSvg } from '../stickers'
import { Hint, Slider, Toggle } from './controls'

export function StickerProperties({ o }: { o: StickerObject }): ReactNode {
  const set = (patch: Partial<StickerObject>): void => useStore.getState().update(o.id, patch)
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
        Drag it in the viewport to move it; drag the corner dot to resize and the top dot to turn it. Stickers sit on
        the frame itself, on top of every effect, and stay put when the camera moves.
      </Hint>
    </>
  )
}
