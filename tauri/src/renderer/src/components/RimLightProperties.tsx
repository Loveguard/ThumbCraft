import { Sparkles, X } from 'lucide-react'
import { useRef, type PointerEvent, type ReactNode } from 'react'
import { useStore, type RimLight, type SceneObject } from '../store'
import { Group, Slider } from './controls'
import { canRim, DEFAULT_RIM } from './rimLight'

/** Quick colours: the rim lights thumbnails use most. */
const RIM_COLOURS = [
  { name: 'Warm sun', color: '#ffe9c4' },
  { name: 'White', color: '#ffffff' },
  { name: 'Ice blue', color: '#8fd3ff' },
  { name: 'Magenta', color: '#ff5fd2' },
  { name: 'Fire', color: '#ff8a2a' },
  { name: 'Toxic green', color: '#7dff6a' },
  { name: 'Blood red', color: '#ff3b3b' },
  { name: 'Purple', color: '#a879ff' }
]

/** A round dial: where the light comes from, dragged around the object's outline. */
function DirectionDial({ angle, onChange }: { angle: number; onChange: (a: number) => void }): ReactNode {
  const ref = useRef<SVGSVGElement>(null)
  const pick = (e: PointerEvent<SVGSVGElement>): void => {
    const r = ref.current!.getBoundingClientRect()
    const x = e.clientX - (r.left + r.width / 2)
    const y = r.top + r.height / 2 - e.clientY
    let a = Math.round((Math.atan2(y, x) * 180) / Math.PI)
    if (e.shiftKey) a = Math.round(a / 45) * 45
    onChange((a + 360) % 360)
  }
  const rad = (angle * Math.PI) / 180
  const cx = 32 + Math.cos(rad) * 24
  const cy = 32 - Math.sin(rad) * 24
  return (
    <svg
      ref={ref}
      className="rim-dial"
      viewBox="0 0 64 64"
      width={64}
      height={64}
      role="slider"
      aria-label="Light direction"
      aria-valuenow={angle}
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId)
        pick(e)
      }}
      onPointerMove={(e) => {
        if (e.currentTarget.hasPointerCapture(e.pointerId)) pick(e)
      }}
    >
      <circle cx={32} cy={32} r={24} className="rim-dial-ring" />
      {/* The object in the middle, lit on the side the light comes from. */}
      <rect x={25} y={22} width={14} height={20} rx={2} className="rim-dial-body" />
      <line x1={32} y1={32} x2={cx} y2={cy} className="rim-dial-ray" />
      <circle cx={cx} cy={cy} r={6} className="rim-dial-sun" />
    </svg>
  )
}

const SIDES: { label: string; angle: number }[] = [
  { label: 'Left', angle: 180 },
  { label: 'Top', angle: 90 },
  { label: 'Right', angle: 0 }
]

/** "Add rim light" on the selected object, and its few settings once it has one. */
export function RimLightProperties({ o }: { o: SceneObject }): ReactNode {
  const update = useStore((s) => s.update)
  if (!canRim(o)) return null
  const rim = o.rim ?? null
  const set = (patch: Partial<RimLight>): void => update(o.id, { rim: { ...(rim ?? DEFAULT_RIM), ...patch } })
  const remove = (): void => update(o.id, { rim: null })
  return (
    <Group
      id="rim"
      title="Rim light"
      icon={<Sparkles size={14} />}
      defaultOpen
      aside={rim ? <span className="rim-chip" style={{ background: rim.color }} /> : undefined}
    >
      {!rim ? (
        <>
          <button className="primary rim-add" onClick={() => set({})}>
            <Sparkles size={15} />
            Add rim light
          </button>
          <p className="field-note">
            A bright edge on this {o.kind === 'player' ? 'character' : 'object'} only, as if lit from behind. It's
            painted on the picture, so nothing else in the scene changes.
          </p>
        </>
      ) : (
        <>
          <div className="rim-direction">
            <DirectionDial angle={rim.angle} onChange={(angle) => set({ angle })} />
            <div className="rim-direction-side">
              <span className="field-label">Light from</span>
              <div className="segmented">
                {SIDES.map((s) => (
                  <button
                    key={s.label}
                    className={rim.angle === s.angle ? 'active' : ''}
                    onClick={() => set({ angle: s.angle })}
                  >
                    {s.label}
                  </button>
                ))}
              </div>
              <span className="field-note">Drag the dial for any angle (Shift snaps).</span>
            </div>
          </div>
          <Slider
            label="Brightness"
            min={0}
            max={4}
            step={0.05}
            value={rim.intensity}
            onChange={(intensity) => set({ intensity })}
          />
          <Slider
            label="Width"
            title="How far in from the edge the light reaches"
            min={1}
            max={40}
            step={0.5}
            value={rim.width}
            format={(v) => `${v}px`}
            onChange={(width) => set({ width })}
          />
          <Slider
            label="Wrap around"
            title="How much of the outline is lit: one side only, or all the way round"
            min={0}
            max={1}
            step={0.01}
            value={rim.wrap}
            format={(v) => `${Math.round(v * 100)}%`}
            onChange={(wrap) => set({ wrap })}
          />
          <div className="field col">
            <span>Colour</span>
            <div className="swatches">
              {RIM_COLOURS.map((c) => (
                <button
                  key={c.name}
                  className={`swatch ${rim.color.toLowerCase() === c.color ? 'active' : ''}`}
                  title={c.name}
                  aria-label={c.name}
                  style={{ background: c.color }}
                  onClick={() => set({ color: c.color })}
                />
              ))}
              <input
                type="color"
                className="rim-custom"
                title="Any colour"
                value={rim.color}
                onChange={(e) => set({ color: e.target.value })}
              />
            </div>
          </div>
          <button className="ghost rim-remove" onClick={remove}>
            <X size={14} />
            Remove rim light
          </button>
        </>
      )}
    </Group>
  )
}
