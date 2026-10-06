// Small image helpers shared across the renderer.

/** CSS hex for a Minecraft colour int (biome json colours), or the fallback when it is missing. */
export const hexColor = (c: number | undefined, fallback = '#000000'): string =>
  c === undefined ? fallback : `#${c.toString(16).padStart(6, '0')}`

/** Decodes an image (blob, data or media URL), rejecting with `error` if it can't be read. */
export function decodeImage(url: string, error = 'Could not read the image'): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error(error))
    img.src = url
  })
}
