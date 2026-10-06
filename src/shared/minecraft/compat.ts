// ThumbCraft reads Minecraft 1.18 and newer (the 1.18 world format is what the generator and world import
// read). Uses the version json's releaseTime (works for releases and snapshots), falling back to the id.

const CAVES_AND_CLIFFS = Date.parse('2021-09-15') // first 1.18 snapshot, with the new chunk format
const LOCATE_BIOME = Date.parse('2022-06-07') // 1.19 renamed `locatebiome` to `locate biome`

/** Approximate release dates for plain release ids when no version json is available. */
const RELEASES: [string, string][] = [
  ['1.18', '2021-11-30'],
  ['1.19', '2022-06-07'],
  ['1.20', '2023-06-07'],
  ['1.21', '2024-06-13']
]

/** Compares dotted version numbers (1.20.4 < 1.21); missing parts count as 0. */
export function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map((n) => parseInt(n, 10) || 0)
  const pb = b.split('.').map((n) => parseInt(n, 10) || 0)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0)
    if (d) return d
  }
  return 0
}

/** Best guess at a version's release time (ms). Unknown ids (modded names, new schemes) count as current. */
export function releaseTimeOf(id: string, releaseTime?: string): number {
  const t = releaseTime ? Date.parse(releaseTime) : NaN
  if (!Number.isNaN(t)) return t
  const m = /^(\d+\.\d+(?:\.\d+)?)/.exec(id)
  if (m && m[1].startsWith('1.')) {
    let best = 0
    for (const [v, d] of RELEASES) if (compareVersions(m[1], v) >= 0) best = Date.parse(d)
    return best
  }
  // One fixed "newest" value, so two unknown ids tie (and sort by install date) instead of by call order.
  return UNKNOWN_IS_CURRENT
}

/** Release time given to ids we can't date (modded profiles, new naming schemes): treat them as current. */
const UNKNOWN_IS_CURRENT = 8.64e15

export const isSupported = (id: string, releaseTime?: string): boolean =>
  releaseTimeOf(id, releaseTime) >= CAVES_AND_CLIFFS

/** Command used to find a biome on the generator server. */
export const locateCommand = (id: string, releaseTime?: string): 'locate biome' | 'locatebiome' =>
  releaseTimeOf(id, releaseTime) >= LOCATE_BIOME ? 'locate biome' : 'locatebiome'
