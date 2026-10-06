import { Fragment, useEffect, useRef, useState, type ReactNode } from 'react'
import * as THREE from 'three'
import {
  Box,
  BringToFront,
  ChevronDown,
  Eye,
  EyeOff,
  Image as ImageIcon,
  Lightbulb,
  Mountain,
  RectangleVertical,
  SendToBack,
  Shapes,
  Trash2,
  Type,
  User,
  Video,
  Zap,
  Flame,
  type LucideIcon
} from 'lucide-react'
import { fullPose, POSES, type PartName, type Pose } from '@shared/minecraft/playerModel'
import { useStore, type MirrorObject, type MobObject, type PlayerObject, type SceneObject, type Vec3 } from '../store'
import { Group, Hint, NumberInput, NumberRow, readFlag, ScrubNumber, Toggle, writeFlag } from './controls'
import { EquipmentProperties } from './EquipmentProperties'
import { LightProperties } from './LightProperties'
import { LightningProperties } from './LightningProperties'
import { VfxProperties } from './VfxProperties'
import { MobProperties } from './MobProperties'
import { TextProperties } from './TextProperties'
import { BACKDROPS } from '@shared/minecraft/backdrops'
import { applyReadyMadeBiome } from '../sceneActions'
import { CutoutControls } from './CutoutControls'
import { viewport } from './Viewport'
import { defaultSkinUrl } from '../minecraft/builders'
import { RENDER_MODES } from '../renderModes'
import { TITLE_STYLES, TITLE_SWATCHES } from './tabs/SceneTabs'

export const KIND_ICON: Record<SceneObject['kind'], LucideIcon> = {
  terrain: Mountain,
  player: User,
  image: ImageIcon,
  video: Video,
  text: Type,
  pixelText: Type,
  mob: Box,
  light: Lightbulb,
  model: Shapes,
  mirror: RectangleVertical,
  lightning: Zap,
  vfx: Flame
}

/** Collapsible inspector section; remembers whether it was open. */
export function Section({
  id,
  title,
  defaultOpen = true,
  actions,
  children
}: {
  id: string
  title: ReactNode
  defaultOpen?: boolean
  actions?: ReactNode
  children: ReactNode
}): ReactNode {
  const [open, setOpen] = useState(() => readFlag(`section:${id}`, defaultOpen))
  const toggle = (): void => {
    setOpen(!open)
    writeFlag(`section:${id}`, !open)
  }
  return (
    <section className={`insp-section ${open ? 'open' : ''}`}>
      <header>
        <button className="section-toggle" onClick={toggle} aria-expanded={open}>
          <ChevronDown size={15} className="chev" />
          <span>{title}</span>
        </button>
        {actions}
      </header>
      {open && <div className="section-body">{children}</div>}
    </section>
  )
}

/** Moves an object toward (+) or away from (−) the camera along the view direction. */
export function pushAlongView(o: SceneObject, amount: number): void {
  const cam = viewport.camera
  if (!cam) return
  const dir = new THREE.Vector3()
  cam.getWorldDirection(dir)
  const p = new THREE.Vector3(...o.position).addScaledVector(dir, -amount)
  useStore.getState().update(o.id, { position: [p.x, p.y, p.z] })
}

function Layers(): ReactNode {
  const objects = useStore((s) => s.objects)
  const selectedId = useStore((s) => s.selectedId)
  const { select, update, remove } = useStore.getState()
  return (
    <Section id="layers" title={`Layers${objects.length ? ` · ${objects.length}` : ''}`}>
      {objects.length === 0 && (
        <div className="empty">
          <strong>Your scene is empty</strong>
          <span>Pick a biome, build, player or text from the left to get started.</span>
        </div>
      )}
      <ul className="layers">
        {[...objects].reverse().map((o) => {
          const Icon = KIND_ICON[o.kind]
          return (
            <li
              key={o.id}
              className={`${o.id === selectedId ? 'active' : ''} ${o.visible ? '' : 'hidden'}`}
              onClick={() => select(o.id)}
            >
              <Icon size={15} className="kind" />
              <span className="name">{o.name}</span>
              <button
                className="icon-btn sm"
                title={o.visible ? 'Hide' : 'Show'}
                onClick={(e) => {
                  e.stopPropagation()
                  update(o.id, { visible: !o.visible })
                }}
              >
                {o.visible ? <Eye size={15} /> : <EyeOff size={15} />}
              </button>
              <button
                className="icon-btn sm danger"
                title="Delete (Del)"
                onClick={(e) => {
                  e.stopPropagation()
                  remove(o.id)
                }}
              >
                <Trash2 size={15} />
              </button>
            </li>
          )
        })}
      </ul>
    </Section>
  )
}

/** Shoulders/hips get full X/Y/Z angles; elbows and knees get a bend slider (they hinge around X). */
const JOINTS: { part: PartName; label: string; bend?: PartName; bendLabel?: string; bendSign?: number }[] = [
  { part: 'head', label: 'Head' },
  { part: 'body', label: 'Body' },
  { part: 'rightArm', label: 'Right arm', bend: 'rightForearm', bendLabel: 'Right elbow', bendSign: -1 },
  { part: 'leftArm', label: 'Left arm', bend: 'leftForearm', bendLabel: 'Left elbow', bendSign: -1 },
  { part: 'rightLeg', label: 'Right leg', bend: 'rightShin', bendLabel: 'Right knee', bendSign: 1 },
  { part: 'leftLeg', label: 'Left leg', bend: 'leftShin', bendLabel: 'Left knee', bendSign: 1 }
]

function PlayerPose({ o }: { o: PlayerObject }): ReactNode {
  const ikMode = useStore((s) => s.ikMode)
  const { update, setIkMode } = useStore.getState()
  const pose = fullPose(o.pose)
  const same = (p: Pose): boolean => JSON.stringify(pose) === JSON.stringify(p)
  return (
    <>
      <h4>Pose</h4>
      <div className="chips">
        {Object.keys(POSES).map((p) => (
          <button
            key={p}
            className={`chip ${same(POSES[p]) ? 'active' : ''}`}
            onClick={() => update(o.id, { pose: structuredClone(POSES[p]) })}
          >
            {p}
          </button>
        ))}
      </div>
      <Toggle label="Name tag" checked={!!o.nameTag} onChange={(nameTag) => update(o.id, { nameTag })} />
      <Toggle label="Slim arms (Alex model)" checked={o.slim} onChange={(slim) => update(o.id, { slim })} />
      <Group id="joints" title="Joints" defaultOpen>
        <Toggle
          label="Drag hands & feet in the viewport"
          title="Click an arm or leg, then drag the green dot on the hand or foot; elbows and knees follow"
          checked={ikMode}
          onChange={setIkMode}
        />
        <PoseJoints o={o} />
        <div className="row">
          <button onClick={() => update(o.id, { pose: structuredClone(POSES.Standing) })}>Reset pose</button>
        </div>
        <Hint>
          Drag a value left or right to turn that joint, or click it to type. Clicking a joint's name (or a limb in the
          viewport) shows rotate handles for it.
        </Hint>
      </Group>
    </>
  )
}

function PoseJoints({ o }: { o: PlayerObject }): ReactNode {
  const selectedJoint = useStore((s) => s.selectedJoint)
  const { update, selectJoint } = useStore.getState()
  const pose = fullPose(o.pose)
  const setJoint = (part: PartName, v: Vec3): void => update(o.id, { pose: { ...pose, [part]: v } })
  return (
    <div className="pose-joints">
      {JOINTS.map((j) => (
        <Fragment key={j.part}>
          <NumberRow
            label={j.label}
            step={1}
            digits={0}
            suffix="°"
            value={pose[j.part]}
            active={selectedJoint === j.part}
            onLabelClick={() => selectJoint(j.part)}
            onChange={(v) => setJoint(j.part, v)}
          />
          {j.bend && (
            <div className={`vec-row ${selectedJoint === j.bend ? 'active' : ''}`}>
              <span className="clickable sub" onClick={() => selectJoint(j.bend!)}>
                {j.bendLabel}
              </span>
              <ScrubNumber
                label="Bend"
                digits={0}
                suffix="°"
                min={-10}
                max={150}
                value={pose[j.bend][0] * j.bendSign!}
                onChange={(n) => setJoint(j.bend!, [n * j.bendSign!, pose[j.bend!][1], pose[j.bend!][2]])}
              />
            </div>
          )}
        </Fragment>
      ))}
    </div>
  )
}

function MirrorProperties({ o }: { o: MirrorObject }): ReactNode {
  const set = (patch: Partial<MirrorObject>): void => useStore.getState().update(o.id, patch)
  return (
    <>
      <h4>Mirror</h4>
      <div className="row">
        <label className="field">
          <span>Width</span>
          <NumberInput min={0.25} step={0.5} value={o.width} onChange={(width) => set({ width })} />
        </label>
        <label className="field">
          <span>Height</span>
          <NumberInput min={0.25} step={0.5} value={o.height} onChange={(height) => set({ height })} />
        </label>
      </div>
      <label className="field">
        <span>Tint</span>
        <input type="color" value={o.tint} onChange={(e) => set({ tint: e.target.value })} />
      </label>
      <label className="check">
        <input type="checkbox" checked={o.frame} onChange={(e) => set({ frame: e.target.checked })} />
        <span>Wooden frame</span>
      </label>
    </>
  )
}

/**
 * Renaming a player to a Minecraft username swaps in that account's skin (after a short pause in typing),
 * so template placeholders become your own character without re-adding them. Steve and Alex go back to the
 * game's default skins; names that aren't accounts keep the current skin.
 */
function SkinFromName({ o }: { o: PlayerObject }): null {
  const last = useRef(o.name)
  useEffect(() => {
    if (o.name === last.current) return
    last.current = o.name
    const name = o.name.trim()
    const timer = setTimeout(async () => {
      const { update, setStatus } = useStore.getState()
      const stillNamed = (): boolean => useStore.getState().objects.some((x) => x.id === o.id && x.name.trim() === name)
      if (/^(steve|alex)$/i.test(name)) {
        const slim = /^alex$/i.test(name)
        update(o.id, { skinUrl: defaultSkinUrl(slim), slim })
        return
      }
      if (!/^[A-Za-z0-9_]{3,16}$/.test(name)) return
      try {
        const skin = await window.blockframe.fetchSkin(name)
        if (!stillNamed()) return
        update(o.id, { skinUrl: skin.skinDataUrl, slim: skin.model === 'slim' })
        setStatus(`Now wearing ${skin.username}'s skin`)
      } catch {
        if (stillNamed()) setStatus(`No Minecraft account named "${name}", so the skin stays the same`)
      }
    }, 700)
    return () => clearTimeout(timer)
  }, [o.id, o.name])
  return null
}

const KIND_LABEL: Record<SceneObject['kind'], string> = {
  terrain: 'Terrain',
  player: 'Player',
  image: 'Image',
  video: 'Video',
  text: 'Title text',
  pixelText: '3D text',
  mob: 'Mob',
  light: 'Light',
  model: '3D model',
  mirror: 'Mirror',
  lightning: 'Lightning',
  vfx: 'Effect'
}

/** Exact position, rotation and size, plus nudges; folded away because the viewport gizmo does most of this. */
function TransformGroup({ o }: { o: SceneObject }): ReactNode {
  const { update, reorder } = useStore.getState()
  const set = (patch: Partial<SceneObject>): void => update(o.id, patch)
  return (
    <Group id="transform" title="Position & size">
      <NumberRow label="Position" value={o.position} onChange={(position) => set({ position })} />
      <NumberRow
        label="Rotation"
        value={o.rotation}
        step={1}
        digits={0}
        suffix="°"
        onChange={(rotation) => set({ rotation })}
      />
      <div className="vec-row">
        <span>Scale</span>
        <ScrubNumber step={0.05} min={0.01} digits={2} value={o.scale} onChange={(scale) => set({ scale })} />
      </div>
      {OVERLAY_KINDS.has(o.kind) && !(o.kind === 'terrain' && o.ground) && (
        <>
          <Toggle
            label="Always on top"
            title="Drawn over everything, even terrain or trees in front of it"
            checked={!!o.onTop}
            onChange={(onTop) => set({ onTop })}
          />
          <Toggle
            label="Flat lighting"
            title="Its own colours, evenly bright: no shading from lights or shadows"
            checked={!!o.flat}
            onChange={(flat) => set({ flat })}
          />
        </>
      )}
      <div className="icon-row">
        <button className="icon-btn" title="Draw above other overlay layers" onClick={() => reorder(o.id, 1)}>
          <BringToFront size={16} />
        </button>
        <button className="icon-btn" title="Draw below other overlay layers" onClick={() => reorder(o.id, -1)}>
          <SendToBack size={16} />
        </button>
      </div>
    </Group>
  )
}

/** Objects that can be drawn on top of the scene and unlit (flat images and text have their own switch). */
const OVERLAY_KINDS = new Set<SceneObject['kind']>(['terrain', 'player', 'mob', 'pixelText', 'model', 'vfx'])

function Properties({ o }: { o: SceneObject }): ReactNode {
  const { update } = useStore.getState()
  const set = (patch: Partial<SceneObject>): void => update(o.id, patch)
  return (
    <Section id="selection" title={KIND_LABEL[o.kind]}>
      <div className="obj-title">
        <input
          value={o.name}
          title={o.kind === 'player' ? "Type a Minecraft username to use that player's skin" : 'Rename'}
          onChange={(e) => set({ name: e.target.value })}
        />
      </div>
      {o.kind === 'player' && (
        <>
          <SkinFromName o={o} />
          <p className="field-note">Type a Minecraft username as the name to wear that player's skin.</p>
        </>
      )}

      {o.kind === 'terrain' && o.ground && (
        <div className="field col">
          <span>Swap for a ready-made biome</span>
          <div className="row wrap">
            {BACKDROPS.map((b) => (
              <button key={b.id} onClick={() => applyReadyMadeBiome(b.id)}>
                {b.name}
              </button>
            ))}
          </div>
        </div>
      )}

      {o.kind === 'player' && <PlayerPose o={o} />}
      {o.kind === 'player' && <EquipmentProperties o={o} />}

      {(o.kind === 'image' || o.kind === 'video') && (
        <>
          <label className="field">
            <span>Opacity</span>
            <input
              type="range"
              min={0}
              max={1}
              step={0.01}
              value={o.opacity}
              onChange={(e) => set({ opacity: Number(e.target.value) })}
            />
          </label>
          <label className="field">
            <span>Tint</span>
            <input type="color" value={o.tint ?? '#ffffff'} onChange={(e) => set({ tint: e.target.value })} />
            <button className="ghost" onClick={() => set({ tint: undefined })}>
              None
            </button>
          </label>
          {o.kind === 'image' && <CutoutControls o={o} />}
          <label className="check">
            <input type="checkbox" checked={!!o.pixelated} onChange={(e) => set({ pixelated: e.target.checked })} />
            <span>Pixel-art scaling (no blur)</span>
          </label>
          <label className="check">
            <input type="checkbox" checked={o.onTop} onChange={(e) => set({ onTop: e.target.checked })} />
            <span>Always on top (overlay)</span>
          </label>
        </>
      )}

      {o.kind === 'mob' && <MobProperties o={o as MobObject} />}
      {o.kind === 'light' && <LightProperties o={o} />}
      {o.kind === 'lightning' && <LightningProperties o={o} />}
      {o.kind === 'vfx' && <VfxProperties o={o} />}
      {o.kind === 'mirror' && <MirrorProperties o={o} />}

      {o.kind === 'text' && <TextProperties o={o} />}

      {o.kind === 'pixelText' && (
        <>
          <label className="field col">
            <span>Text</span>
            <textarea rows={2} value={o.text} onChange={(e) => set({ text: e.target.value })} />
          </label>
          <div className="segmented">
            {([{ style: 'plain', label: 'Font', color: '#ffffff' }, ...TITLE_STYLES] as const).map((t) => (
              <button
                key={t.style}
                className={(o.style ?? 'plain') === t.style ? 'active' : ''}
                onClick={() => set({ style: t.style, color: t.color })}
              >
                {t.label}
              </button>
            ))}
          </div>
          <label className="field">
            <span>Colour</span>
            <input type="color" value={o.color} onChange={(e) => set({ color: e.target.value })} />
          </label>
          {(o.style ?? 'plain') !== 'plain' && (
            <div className="swatches">
              {TITLE_SWATCHES.map((c) => (
                <button
                  key={c.name}
                  className={`swatch ${o.color.toLowerCase() === c.color ? 'active' : ''}`}
                  title={c.name}
                  aria-label={c.name}
                  style={{ background: c.color }}
                  onClick={() => set({ color: c.color })}
                />
              ))}
            </div>
          )}
          <label className="field">
            <span>Depth</span>
            <input
              type="range"
              min={1}
              max={8}
              value={o.depth}
              onChange={(e) => set({ depth: Number(e.target.value) })}
            />
          </label>
          <label className="check">
            <input type="checkbox" checked={o.shadow} onChange={(e) => set({ shadow: e.target.checked })} />
            <span>{(o.style ?? 'plain') === 'plain' ? 'Minecraft text shadow' : 'Black outline'}</span>
          </label>
        </>
      )}
      <TransformGroup o={o} />
    </Section>
  )
}

function SceneSettings(): ReactNode {
  const s = useStore((st) => st.settings)
  const setSettings = useStore((st) => st.setSettings)
  return (
    <Section id="scene" title="Scene & lighting" defaultOpen={false}>
      <div className="segmented">
        {RENDER_MODES.map((m) => (
          <button
            key={m.id}
            title={m.hint}
            className={s.renderMode === m.id ? 'active' : ''}
            onClick={() => setSettings({ renderMode: m.id })}
          >
            {m.label}
          </button>
        ))}
      </div>
      <label className="check">
        <input
          type="checkbox"
          checked={s.ambientOcclusion}
          onChange={(e) => setSettings({ ambientOcclusion: e.target.checked })}
        />
        <span>Smooth lighting (ambient occlusion)</span>
      </label>
      <label className="check">
        <input type="checkbox" checked={s.fog} onChange={(e) => setSettings({ fog: e.target.checked })} />
        <span>Biome fog</span>
      </label>
      <label className="field">
        <span>FOV {s.fov}°</span>
        <input
          type="range"
          min={30}
          max={110}
          value={s.fov}
          onChange={(e) => setSettings({ fov: Number(e.target.value) })}
        />
      </label>
      <p className="hint">Sky presets and HDRIs are in the Sky tab on the left.</p>
    </Section>
  )
}

export function RightPanel(): ReactNode {
  const selected = useStore((s) => s.objects.find((o) => o.id === s.selectedId))
  return (
    <aside className="inspector">
      <Layers />
      {selected && <Properties key={selected.id} o={selected} />}
      <SceneSettings />
    </aside>
  )
}
