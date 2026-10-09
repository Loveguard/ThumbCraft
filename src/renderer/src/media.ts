// Bytes of files the user brought in (images, videos, HDRIs). Kept in memory so projects can embed
// them and still open after the original files are moved or deleted.
import { newId, useStore, type SceneObject } from './store'

export interface MediaEntry {
  id: string
  name: string
  mime: string
  bytes: Uint8Array
  /** blob: URL for use in the renderer (recreated when a project is opened). */
  url: string
  /** When it was added; brand-new media may still be mid-import, so pruning leaves it alone. */
  addedAt: number
}

export const mediaStore = new Map<string, MediaEntry>()

export function registerMedia(name: string, mime: string, bytes: Uint8Array, id = newId('media')): MediaEntry {
  const existing = mediaStore.get(id)
  if (existing) URL.revokeObjectURL(existing.url)
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: mime || 'application/octet-stream' }))
  const entry = { id, name, mime, bytes, url, addedAt: Date.now() }
  mediaStore.set(id, entry)
  return entry
}

export async function registerFile(file: File): Promise<MediaEntry> {
  return registerMedia(file.name, file.type, new Uint8Array(await file.arrayBuffer()))
}

export function clearMedia(): void {
  for (const m of mediaStore.values()) URL.revokeObjectURL(m.url)
  mediaStore.clear()
}

/** Media files an object uses (so they are saved with the project and kept in memory). */
export function mediaIdsOf(o: SceneObject, out: Set<string>): Set<string> {
  if ((o.kind === 'image' || o.kind === 'video') && o.mediaId) out.add(o.mediaId)
  if (o.kind === 'light' && o.goboMediaId) out.add(o.goboMediaId)
  if (o.kind === 'model') for (const id of [o.mediaId, ...o.extraMediaIds]) out.add(id)
  if (o.kind === 'text' && o.fontMediaId) out.add(o.fontMediaId)
  return out
}

/**
 * Frees media nothing refers to any more (replaced HDRIs, deleted images, failed imports). Anything the
 * scene or its undo history still uses is kept, so undoing a delete still finds its image.
 */
export function pruneMedia(): void {
  const s = useStore.getState()
  const used = new Set<string>()
  for (const list of [s.objects, ...[...s.past, ...s.future].map((e) => e.objects ?? [])])
    for (const o of list) mediaIdsOf(o, used)
  // The current look, the shared one and every shot's own.
  for (const l of [s, ...(s.sharedLook ? [s.sharedLook] : []), ...s.shots.flatMap((x) => (x.look ? [x.look] : []))]) {
    if (l.sky.hdriMediaId) used.add(l.sky.hdriMediaId)
    if (l.effects.lutMediaId) used.add(l.effects.lutMediaId)
  }
  const now = Date.now()
  for (const [id, m] of mediaStore)
    if (!used.has(id) && now - m.addedAt > 60_000) {
      URL.revokeObjectURL(m.url)
      mediaStore.delete(id)
    }
}
