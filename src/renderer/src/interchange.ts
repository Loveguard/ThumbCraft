// Animations in and out of other tools: Blockbench animation files, and glTF (.glb) models for Blender.
import * as THREE from 'three'
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js'
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js'
import { animationLength, yawOfRotation, type Vec3 } from '@shared/animation'
import { fromBlockbench, toBlockbench, type Imported, type Sample } from '@shared/blockbench'
import { toFrame } from '@shared/presets'
import { animationOf, canWalk, importPoseKeys, stateAt, trackOf } from './animation'
import { viewport } from './components/Viewport'
import { useStore } from './store'

const nameOf = (id: string): string => useStore.getState().objects.find((o) => o.id === id)?.name ?? 'Character'

/** What a character does, as a pose and a place every frame. Null when it has no animation. */
function frames(id: string): { t: number; st: NonNullable<ReturnType<typeof stateAt>> }[] | null {
  const o = useStore.getState().objects.find((x) => x.id === id)
  const tr = trackOf(id)
  if (!o || !tr?.keys.length) return null
  const a = animationOf()
  const length = Math.max(animationLength(a), tr.keys.at(-1)!.t)
  const out: { t: number; st: NonNullable<ReturnType<typeof stateAt>> }[] = []
  const n = Math.ceil(length * a.fps)
  for (let i = 0; i <= n; i++) {
    const t = Math.min(length, i / a.fps)
    const st = stateAt(tr, t, o)
    if (st) out.push({ t, st })
  }
  return out
}

/** A player's animation as the bytes of a Blockbench animation file. */
export function blockbenchBytes(id: string): Uint8Array {
  const list = frames(id)
  const o = useStore.getState().objects.find((x) => x.id === id)
  if (!list?.length || o?.kind !== 'player') throw new Error('Pick a player that has an animation.')
  const first = list[0].st
  const origin = { position: first.position, yaw: yawOfRotation(first.rotation) }
  const samples: Sample[] = list.flatMap(({ t, st }) =>
    st.pose ? [{ t, pose: st.pose, root: toFrame(st.position, origin) }] : []
  )
  return new TextEncoder().encode(
    JSON.stringify(toBlockbench(nameOf(id), samples, { loop: animationOf().loop }), null, 2)
  )
}

/** Saves a player's animation as a Blockbench animation file. Returns the path, or null when cancelled. */
export async function exportBlockbench(id: string): Promise<string | null> {
  return window.blockframe.saveDataFile(blockbenchBytes(id), nameOf(id), 'blockbench')
}

/** Gives a player the animations in a Blockbench file. Returns what it did. */
export function giveBlockbench(id: string, bytes: Uint8Array): string {
  const o = useStore.getState().objects.find((x) => x.id === id)
  if (o?.kind !== 'player') throw new Error('Pick a player to give the animation to.')
  const list: Imported[] = fromBlockbench(new TextDecoder().decode(bytes))
  const a = list[0]
  importPoseKeys(id, a.samples, a.loop)
  const extra = list.length > 1 ? ` (the first of ${list.length}: ${list.map((x) => x.name).join(', ')})` : ''
  const skipped = a.skipped.length ? `. Left out: ${a.skipped.join(', ')}` : ''
  return `Gave ${o.name} "${a.name}"${extra}${skipped}`
}

/** Asks for a Blockbench animation file and gives it to a player. Returns what it did, or null when cancelled. */
export async function importBlockbench(id: string): Promise<string | null> {
  const file = await window.blockframe.openDataFile('blockbench')
  return file ? giveBlockbench(id, file.bytes) : null
}

/** Saves a character, moving as it does in the animation, as a glTF file for Blender. */
export async function exportGlb(id: string): Promise<string | null> {
  const { bytes, name } = await glbBytes(id)
  return window.blockframe.saveDataFile(bytes, name, 'glb')
}

/** A character and its animation as the bytes of a binary glTF file. */
export async function glbBytes(id: string): Promise<{ bytes: Uint8Array; name: string }> {
  const root = viewport.objects.get(id)
  const list = frames(id)
  const o = useStore.getState().objects.find((x) => x.id === id)
  if (!root || !list?.length || !o || !canWalk(o)) throw new Error('Pick a player or mob that has an animation.')
  // A copy without the scene's helpers (name tags, selection boxes), so what is exported is just the model.
  // SkeletonUtils keeps the skinned limbs bound to the copied bones (a plain clone leaves the glTF skins without joints).
  const model = cloneSkinned(root)
  const drop: THREE.Object3D[] = []
  model.traverse((c) => {
    if (c.userData.helper || c instanceof THREE.Sprite || c instanceof THREE.Line || c instanceof THREE.Points)
      drop.push(c)
  })
  for (const c of drop) c.parent?.remove(c)
  model.name = nameOf(id).replace(/[^\w-]+/g, '_') || 'character'
  model.scale.copy(root.scale)

  const times = list.map((f) => f.t)
  const tracks: THREE.KeyframeTrack[] = [
    new THREE.VectorKeyframeTrack(
      `${model.name}.position`,
      times,
      list.flatMap((f) => f.st.position)
    ),
    new THREE.QuaternionKeyframeTrack(
      `${model.name}.quaternion`,
      times,
      list.flatMap((f) => [f.st.quaternion.x, f.st.quaternion.y, f.st.quaternion.z, f.st.quaternion.w])
    )
  ]
  if (o.kind === 'player') {
    const player = model.getObjectByName('player')
    for (const part of Object.keys(list[0].st.pose ?? {})) {
      const node = player?.getObjectByName(part)
      if (!node) continue
      const q = new THREE.Quaternion()
      const e = new THREE.Euler()
      const values: number[] = []
      for (const f of list) {
        const r = f.st.pose?.[part as keyof NonNullable<typeof f.st.pose>] as Vec3 | undefined
        e.set(...((r ?? [0, 0, 0]).map((v) => THREE.MathUtils.degToRad(v)) as Vec3), 'XYZ')
        q.setFromEuler(e)
        values.push(q.x, q.y, q.z, q.w)
      }
      tracks.push(new THREE.QuaternionKeyframeTrack(`${part}.quaternion`, times, values))
    }
  }
  const clip = new THREE.AnimationClip('Animation', -1, tracks)
  const buffer = await new Promise<ArrayBuffer>((resolve, reject) =>
    new GLTFExporter().parse(
      model,
      (r) => (r instanceof ArrayBuffer ? resolve(r) : reject(new Error('No binary'))),
      reject,
      {
        binary: true,
        animations: [clip],
        onlyVisible: false
      }
    )
  )
  return { bytes: new Uint8Array(buffer), name: model.name }
}
