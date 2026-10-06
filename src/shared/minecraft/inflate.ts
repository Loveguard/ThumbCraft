// Bounded decompression: a tiny "zip bomb" in a downloaded map or schematic must not take the app's memory
// (or the whole main process) with it.
import { Gunzip, Unzlib } from 'fflate'

/** Largest a schematic or structure may inflate to. */
export const MAX_INFLATED = 256 * 2 ** 20

function inflateCapped(stream: typeof Gunzip | typeof Unzlib, bytes: Uint8Array, max: number): Uint8Array {
  const parts: Uint8Array[] = []
  let total = 0
  const s = new stream((chunk) => {
    total += chunk.length
    if (total > max) throw new Error(`File unpacks to more than ${max >> 20} MB; it is too large or corrupt`)
    parts.push(chunk)
  })
  const step = 16384
  for (let i = 0; i < bytes.length; i += step) s.push(bytes.subarray(i, i + step), i + step >= bytes.length)
  const out = new Uint8Array(total)
  let at = 0
  for (const p of parts) out.set(p, (at += p.length) - p.length)
  return out
}

/** Gunzips in small steps, giving up as soon as the output passes `max` bytes. */
export const gunzipCapped = (bytes: Uint8Array, max = MAX_INFLATED): Uint8Array => inflateCapped(Gunzip, bytes, max)

/** The same for zlib streams (region-file chunks). */
export const unzlibCapped = (bytes: Uint8Array, max = MAX_INFLATED): Uint8Array => inflateCapped(Unzlib, bytes, max)
