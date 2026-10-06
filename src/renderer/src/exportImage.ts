// Turns a captured PNG into the file the user asked for: a lossless PNG, or a JPG that fits YouTube's
// 2 MB thumbnail limit (the highest quality that does).

import { decodeImage } from './image'

export type ExportFormat = 'jpg' | 'png'

/** YouTube rejects thumbnails over 2 MB; stay a little under. */
export const YOUTUBE_LIMIT = 1.95 * 2 ** 20

const bytesOf = (dataUrl: string): number => Math.floor(((dataUrl.length - dataUrl.indexOf(',') - 1) * 3) / 4)

export async function encodeExport(png: string, format: ExportFormat): Promise<string> {
  if (format === 'png') return png
  const img = await decodeImage(png, 'Could not encode the export')
  const c = document.createElement('canvas')
  c.width = img.naturalWidth
  c.height = img.naturalHeight
  const g = c.getContext('2d')!
  g.fillStyle = '#000' // JPG has no transparency
  g.fillRect(0, 0, c.width, c.height)
  g.drawImage(img, 0, 0)
  let url = ''
  for (const q of [0.95, 0.92, 0.88, 0.84, 0.8, 0.75, 0.7, 0.6, 0.5]) {
    url = c.toDataURL('image/jpeg', q)
    if (bytesOf(url) <= YOUTUBE_LIMIT) break
  }
  return url
}

export const extensionOf = (format: ExportFormat): string => (format === 'jpg' ? 'jpg' : 'png')

export const sizeLabel = (dataUrl: string): string => `${(bytesOf(dataUrl) / 2 ** 20).toFixed(2)} MB`
