// Groups the game's structure pieces for the Builds tab: numbered variants of the same piece
// (plains_small_house_1…8) become one entry, and pieces are sectioned by the folder they live in.

export interface PieceKind {
  label: string
  /** Variant ids, in number order. */
  ids: string[]
}

export interface PieceSection {
  label: string
  kinds: PieceKind[]
}

const words = (s: string): string => {
  const t = s.replace(/_/g, ' ').trim()
  return t.charAt(0).toUpperCase() + t.slice(1)
}

const variantNumber = (id: string): number => Number(/(\d+)$/.exec(id)?.[1] ?? 0)

export function groupStructures(ids: string[]): PieceSection[] {
  const parentOf = (id: string): string[] => id.split('/').slice(0, -1)
  // Folder levels every result shares (e.g. "village/plains/houses") say nothing; label sections by the rest.
  const parents = ids.map(parentOf)
  let shared = 0
  while (parents.length && parents.every((p) => p.length > shared && p[shared] === parents[0][shared])) shared++

  const sections = new Map<string, Map<string, PieceKind>>()
  for (const id of ids) {
    const parent = parentOf(id)
    const rest = parent.slice(shared)
    const section = rest.length ? rest.map(words).join(' · ') : parent.length ? words(parent[parent.length - 1]) : ''
    const name = id.split('/').pop()!
    const base = name.replace(/_?\d+$/, '')
    // "plains_small_house" inside village/plains/houses reads as "Small house".
    const tokens = base.split('_').filter((t) => !parent.includes(t))
    const label = words(tokens.join('_') || base)
    const kinds = sections.get(section) ?? new Map<string, PieceKind>()
    sections.set(section, kinds)
    const key = `${parent.join('/')}/${base}`
    const kind = kinds.get(key) ?? { label, ids: [] }
    kinds.set(key, kind)
    kind.ids.push(id)
  }
  return [...sections.entries()]
    .map(([label, kinds]) => ({
      label,
      kinds: [...kinds.values()]
        .map((k) => ({ ...k, ids: k.ids.sort((a, b) => variantNumber(a) - variantNumber(b)) }))
        .sort((a, b) => a.label.localeCompare(b.label))
    }))
    .sort((a, b) => a.label.localeCompare(b.label))
}

export interface StructureCategory {
  id: string
  label: string
  ids: string[]
}

/** The game's structure families, in the order thumbnail makers reach for them. */
const FAMILIES: [string, string, RegExp][] = [
  ['village', 'Villages', /^village\/(plains|desert|savanna|snowy|taiga)\//],
  ['ancient_city', 'Ancient city', /^ancient_city\//],
  ['trial_chambers', 'Trial chambers', /^trial_chambers\//],
  ['trail_ruins', 'Trail ruins', /^trail_ruins\//],
  ['ruined_portal', 'Ruined portals', /^ruined_portal\//],
  ['pillager_outpost', 'Pillager outpost', /^pillager_outpost\//],
  ['shipwreck', 'Shipwrecks', /^shipwreck\//],
  ['underwater_ruin', 'Ocean ruins', /^underwater_ruin\//],
  ['bastion', 'Bastion', /^bastion\//],
  ['end_city', 'End city', /^end_city\//],
  ['fossil', 'Fossils', /^(fossil|nether_fossils)\//],
  ['igloo', 'Igloo', /^igloo\//]
]

/**
 * Pieces that aren't buildings: villager and animal spawns (entities only, nothing to draw), spawner
 * markers, and the flat path tiles that join village houses.
 */
const NOT_BUILDINGS =
  /\/(villagers?|animals|mobs?|iron_golem|spawner|entities|streets|terminators)(\/|$)|_(villager|animal)s?\b/

export const VILLAGE_BIOMES = ['plains', 'desert', 'savanna', 'snowy', 'taiga'] as const

/** Sorts the jar's structure pieces into families; whatever fits none lands in Other. */
export function structureCategories(ids: string[]): StructureCategory[] {
  const out = FAMILIES.map(([id, label]) => ({ id, label, ids: [] as string[] }))
  const other: string[] = []
  for (const id of ids) {
    if (NOT_BUILDINGS.test(id)) continue
    const i = FAMILIES.findIndex(([, , re]) => re.test(id))
    if (i >= 0) out[i].ids.push(id)
    else if (!id.startsWith('village/')) other.push(id)
  }
  return [...out, { id: 'other', label: 'Other', ids: other }].filter((c) => c.ids.length)
}
