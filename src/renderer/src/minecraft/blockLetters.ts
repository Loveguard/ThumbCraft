// A chunky 5×5 block alphabet for carved logo-style titles. Each glyph is drawn heavier when built (every
// pixel becomes a thick block with narrow slits between strokes), so these stay simple and square.

const GLYPHS: Record<string, string[]> = {
  A: ['.XXX.', 'X...X', 'XXXXX', 'X...X', 'X...X'],
  B: ['XXXX.', 'X...X', 'XXXX.', 'X...X', 'XXXX.'],
  C: ['.XXXX', 'X....', 'X....', 'X....', '.XXXX'],
  D: ['XXXX.', 'X...X', 'X...X', 'X...X', 'XXXX.'],
  E: ['XXXXX', 'X....', 'XXXX.', 'X....', 'XXXXX'],
  F: ['XXXXX', 'X....', 'XXXX.', 'X....', 'X....'],
  G: ['.XXXX', 'X....', 'X..XX', 'X...X', '.XXXX'],
  H: ['X...X', 'X...X', 'XXXXX', 'X...X', 'X...X'],
  I: ['XXX', '.X.', '.X.', '.X.', 'XXX'],
  J: ['....X', '....X', '....X', 'X...X', '.XXX.'],
  K: ['X...X', 'X..X.', 'XXX..', 'X..X.', 'X...X'],
  L: ['X....', 'X....', 'X....', 'X....', 'XXXXX'],
  M: ['X...X', 'XX.XX', 'X.X.X', 'X...X', 'X...X'],
  N: ['X...X', 'XX..X', 'X.X.X', 'X..XX', 'X...X'],
  O: ['.XXX.', 'X...X', 'X...X', 'X...X', '.XXX.'],
  P: ['XXXX.', 'X...X', 'XXXX.', 'X....', 'X....'],
  Q: ['.XXX.', 'X...X', 'X...X', 'X..X.', '.XX.X'],
  R: ['XXXX.', 'X...X', 'XXXX.', 'X..X.', 'X...X'],
  S: ['.XXXX', 'X....', '.XXX.', '....X', 'XXXX.'],
  T: ['XXXXX', '..X..', '..X..', '..X..', '..X..'],
  U: ['X...X', 'X...X', 'X...X', 'X...X', '.XXX.'],
  V: ['X...X', 'X...X', 'X...X', '.X.X.', '..X..'],
  W: ['X...X', 'X...X', 'X.X.X', 'XX.XX', 'X...X'],
  X: ['X...X', '.X.X.', '..X..', '.X.X.', 'X...X'],
  Y: ['X...X', '.X.X.', '..X..', '..X..', '..X..'],
  Z: ['XXXXX', '...X.', '..X..', '.X...', 'XXXXX'],
  '0': ['.XXX.', 'X..XX', 'X.X.X', 'XX..X', '.XXX.'],
  '1': ['.X.', 'XX.', '.X.', '.X.', 'XXX'],
  '2': ['XXXX.', '....X', '.XXX.', 'X....', 'XXXXX'],
  '3': ['XXXX.', '....X', '.XXX.', '....X', 'XXXX.'],
  '4': ['X..X.', 'X..X.', 'XXXXX', '...X.', '...X.'],
  '5': ['XXXXX', 'X....', 'XXXX.', '....X', 'XXXX.'],
  '6': ['.XXX.', 'X....', 'XXXX.', 'X...X', '.XXX.'],
  '7': ['XXXXX', '....X', '...X.', '..X..', '..X..'],
  '8': ['.XXX.', 'X...X', '.XXX.', 'X...X', '.XXX.'],
  '9': ['.XXX.', 'X...X', '.XXXX', '....X', '.XXX.'],
  '!': ['X', 'X', 'X', '.', 'X'],
  '?': ['XXXX.', '....X', '..XX.', '.....', '..X..'],
  '.': ['.', '.', '.', '.', 'X'],
  ',': ['..', '..', '..', '.X', 'X.'],
  "'": ['X', 'X', '.', '.', '.'],
  '"': ['X.X', 'X.X', '...', '...', '...'],
  ':': ['.', 'X', '.', 'X', '.'],
  '-': ['...', '...', 'XXX', '...', '...'],
  '+': ['.....', '..X..', '.XXX.', '..X..', '.....'],
  '#': ['.X.X.', 'XXXXX', '.X.X.', 'XXXXX', '.X.X.'],
  '&': ['.XX..', 'X..X.', '.XX.X', 'X..X.', '.XX.X'],
  '/': ['....X', '...X.', '..X..', '.X...', 'X....'],
  '%': ['XX..X', 'XX.X.', '..X..', '.X.XX', 'X..XX'],
  $: ['.XXXX', 'X.X..', '.XXX.', '..X.X', 'XXXX.'],
  '♥': ['XX.XX', 'XXXXX', 'XXXXX', '.XXX.', '..X..'],
  ' ': ['...', '...', '...', '...', '...']
}

/** Width in letter pixels left for a heart sprite drawn in place of a glyph (see `hearts`). */
export const HEART_ADVANCE = 6

/**
 * Filled pixels for `text` in the block alphabet: one cell per pixel, lines 7 pixels apart.
 * With `heartsForO`, every O (and ♥ or <3) leaves a gap and its top-left pixel is listed in `hearts`,
 * for a heart sprite to be drawn there instead.
 */
export function blockLetterCells(
  text: string,
  heartsForO = false
): { filled: Set<string>; width: number; height: number; hearts: [number, number][] } {
  const lines = text.toUpperCase().replace(/<3/g, '♥').split('\n')
  const filled = new Set<string>()
  const hearts: [number, number][] = []
  let width = 0
  lines.forEach((line, row) => {
    let cursor = 0
    for (const ch of line) {
      if (heartsForO && (ch === 'O' || ch === '♥')) {
        hearts.push([cursor, row * 7])
        cursor += HEART_ADVANCE + 1
        continue
      }
      const g = GLYPHS[ch] ?? GLYPHS['?']
      g.forEach((r, y) => [...r].forEach((p, x) => p === 'X' && filled.add(`${cursor + x},${row * 7 + y}`)))
      cursor += g[0].length + 1
    }
    width = Math.max(width, cursor - 1)
  })
  return { filled, width, height: lines.length * 7 - 2, hearts }
}

/**
 * The hardcore-mode heart, as the game draws it: dark outline, red body with a darker lower edge, a pale
 * highlight top-left. K outline, R red, D dark red, H highlight.
 */
export const HARDCORE_HEART = [
  '.KKK.KKK.',
  'KHHRKRRRK',
  'KHRRRRRDK',
  'KRRRRRRDK',
  'KRRRRRDDK',
  '.KRRRDDK.',
  '..KRDDK..',
  '...KDK...',
  '....K....'
]
