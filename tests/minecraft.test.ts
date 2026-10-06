import { describe, expect, it } from 'vitest'
import { zlibSync } from 'fflate'
import { parseNbt } from '@shared/minecraft/nbt'
import { NBT_TAG, writeNbt, type NbtTyped } from './nbtWriter'
import { ChunkCache, extractTerrain, readChunkFromRegion, unpackPalettedIndices } from '@shared/minecraft/anvil'
import { ModelResolver, conditionMatches, positionSeed, rotateDir } from '@shared/minecraft/blockModel'
import { JavaRandom } from '@shared/minecraft/javaRandom'

const javaNextInt = (seed: bigint, bound: number): number => new JavaRandom(seed).nextInt(bound)
import { meshTerrain, type TextureSlot } from '@shared/minecraft/mesher'
import { blockTint, grassColor, sampleColormap } from '@shared/minecraft/tints'
import { boxFaces, fullPose, normalizeSkin, playerParts, POSES, type Pose } from '@shared/minecraft/playerModel'
import { groupBiomes, parseLocate } from '@shared/minecraft/worldgen'
import type { TerrainData } from '@shared/types'

// ---------------------------------------------------------------- fixtures

const models = {
  'block/block': {},
  'block/cube': {
    parent: 'block/block',
    elements: [
      {
        from: [0, 0, 0],
        to: [16, 16, 16],
        faces: {
          down: { texture: '#down', cullface: 'down' },
          up: { texture: '#up', cullface: 'up' },
          north: { texture: '#north', cullface: 'north' },
          south: { texture: '#south', cullface: 'south' },
          west: { texture: '#west', cullface: 'west' },
          east: { texture: '#east', cullface: 'east' }
        }
      }
    ]
  },
  'block/cube_all': {
    parent: 'block/cube',
    textures: { particle: '#all', down: '#all', up: '#all', north: '#all', east: '#all', south: '#all', west: '#all' }
  },
  'block/stone': { parent: 'minecraft:block/cube_all', textures: { all: 'minecraft:block/stone' } },
  'block/grass_block': {
    parent: 'block/block',
    textures: { bottom: 'block/dirt', top: 'block/grass_block_top', side: 'block/grass_block_side' },
    elements: [
      {
        from: [0, 0, 0],
        to: [16, 16, 16],
        faces: {
          down: { texture: '#bottom', cullface: 'down' },
          up: { texture: '#top', cullface: 'up', tintindex: 0 },
          north: { texture: '#side', cullface: 'north' },
          south: { texture: '#side', cullface: 'south' },
          west: { texture: '#side', cullface: 'west' },
          east: { texture: '#side', cullface: 'east' }
        }
      }
    ]
  },
  'block/furnace': {
    parent: 'block/cube',
    textures: {
      north: 'block/furnace_front',
      south: 'block/furnace_side',
      east: 'block/furnace_side',
      west: 'block/furnace_side',
      up: 'block/furnace_top',
      down: 'block/furnace_top'
    }
  }
}
const blockstates = {
  stone: { variants: { '': { model: 'minecraft:block/stone' } } },
  grass_block: {
    variants: {
      'snowy=false': [{ model: 'block/grass_block' }, { model: 'block/grass_block', y: 90 }],
      'snowy=true': { model: 'block/stone' }
    }
  },
  furnace: {
    variants: { 'facing=north': { model: 'block/furnace' }, 'facing=east': { model: 'block/furnace', y: 90 } }
  }
}

const slot: TextureSlot = { u0: 0, v0: 1, u1: 1, v1: 0, layer: 'opaque' }

// ---------------------------------------------------------------- tests

describe('NBT', () => {
  it('round-trips compounds, lists and long arrays', () => {
    const bytes = writeNbt({
      Name: { type: 'string', value: 'minecraft:stone' },
      Y: { type: 'byte', value: -4 },
      data: { type: 'longArray', value: [1n, -1n] },
      list: { type: 'list', itemType: NBT_TAG.end, value: [{ type: 'int', value: 7 }] }
    })
    const root = parseNbt(bytes)
    expect(root.Name).toBe('minecraft:stone')
    expect(root.Y).toBe(-4)
    expect(Array.from(root.data as BigInt64Array)).toEqual([1n, -1n])
    expect(root.list).toEqual([7])
  })
})

describe('Anvil', () => {
  it('unpacks paletted data without spanning longs', () => {
    // 5 bits per entry -> 12 entries per long.
    const values = Array.from({ length: 20 }, (_, i) => i % 17)
    const longs = [0n, 0n]
    values.forEach((v, i) => (longs[Math.floor(i / 12)] |= BigInt(v) << BigInt((i % 12) * 5)))
    const out = unpackPalettedIndices(BigInt64Array.from(longs.map((l) => BigInt.asIntN(64, l))), 5, 20)
    expect(Array.from(out)).toEqual(values)
  })

  it('reads a chunk out of a region file and extracts terrain', () => {
    // One section at Y=4 (y 64..79): stone floor at y=64, a grass block at (3,65,5).
    const palette = ['minecraft:air', 'minecraft:stone', 'minecraft:grass_block']
    const bits = 4
    const perLong = 16
    const longs = new Array(4096 / perLong).fill(0n)
    const set = (x: number, y: number, z: number, v: number): void => {
      const i = (y * 16 + z) * 16 + x
      longs[Math.floor(i / perLong)] |= BigInt(v) << BigInt((i % perLong) * bits)
    }
    for (let x = 0; x < 16; x++) for (let z = 0; z < 16; z++) set(x, 0, z, 1)
    set(3, 1, 5, 2)
    const section: NbtTyped = {
      type: 'compound',
      value: {
        Y: { type: 'byte', value: 4 },
        block_states: {
          type: 'compound',
          value: {
            palette: {
              type: 'list',
              itemType: NBT_TAG.compound,
              value: palette.map((n): NbtTyped => {
                const value: Record<string, NbtTyped> = { Name: { type: 'string', value: n } }
                if (n === 'minecraft:grass_block')
                  value.Properties = { type: 'compound', value: { snowy: { type: 'string', value: 'false' } } }
                return { type: 'compound', value }
              })
            },
            data: { type: 'longArray', value: longs.map((l) => BigInt.asIntN(64, l)) }
          }
        },
        biomes: {
          type: 'compound',
          value: {
            palette: { type: 'list', itemType: NBT_TAG.string, value: [{ type: 'string', value: 'minecraft:plains' }] }
          }
        }
      }
    }
    const chunk = writeNbt({
      DataVersion: { type: 'int', value: 4000 },
      xPos: { type: 'int', value: 0 },
      zPos: { type: 'int', value: 0 },
      Status: { type: 'string', value: 'minecraft:full' },
      sections: { type: 'list', itemType: NBT_TAG.compound, value: [section] }
    })
    const compressed = zlibSync(chunk)
    const region = new Uint8Array(8192 + Math.ceil((compressed.length + 5) / 4096) * 4096)
    region[0] = 0
    region[1] = 0
    region[2] = 2 // offset: sector 2
    region[3] = Math.ceil((compressed.length + 5) / 4096)
    new DataView(region.buffer).setUint32(8192, compressed.length + 1)
    region[8192 + 4] = 2
    region.set(compressed, 8192 + 5)

    expect(readChunkFromRegion(region, 0, 0)?.Status).toBe('minecraft:full')
    const cache = new ChunkCache((rx, rz) => (rx === 0 && rz === 0 ? region : null))
    expect(cache.allGenerated(0, 0, 0, 0)).toBe(true)
    expect(cache.block(3, 65, 5)?.name).toBe('minecraft:grass_block')
    expect(cache.biome(3, 65, 5)).toBe('minecraft:plains')

    const t = extractTerrain(cache, { centerX: 8, centerZ: 8, size: 16, dimension: 'overworld', depthBelowSurface: 0 })
    expect(t.originY).toBe(64)
    expect(t.sizeY).toBe(2)
    const at = (x: number, y: number, z: number): string => t.palette[t.blocks[x + z * 16 + y * 256]].name
    expect(at(3, 1, 5)).toBe('minecraft:grass_block')
    expect(at(0, 0, 0)).toBe('minecraft:stone')
    expect(at(0, 1, 0)).toBe('minecraft:air')
    expect(t.biomePalette).toEqual(['minecraft:plains'])
  })
})

describe('Block models', () => {
  const resolver = new ModelResolver(blockstates, models)

  it('resolves parent chains and texture variables', () => {
    const [v] = resolver.variantsFor({ name: 'minecraft:stone', properties: {} })
    const baked = resolver.bake(v)
    expect(baked.quads).toHaveLength(6)
    expect(baked.fullCube).toBe(true)
    expect(new Set(baked.quads.map((q) => q.texture))).toEqual(new Set(['block/stone']))
    const north = baked.quads.find((q) => q.dir === 'north')!
    expect(north.uvs).toEqual([
      [0, 0],
      [16, 0],
      [16, 16],
      [0, 16]
    ])
    expect(north.positions[0]).toEqual([1, 1, 0])
  })

  it('applies blockstate y rotation (furnace facing east shows its front east)', () => {
    const [v] = resolver.variantsFor({ name: 'minecraft:furnace', properties: { facing: 'east' } })
    const front = resolver.bake(v).quads.find((q) => q.texture === 'block/furnace_front')!
    expect(front.dir).toBe('east')
    expect(front.cullface).toBe('east')
    expect(rotateDir('north', 0, 90)).toBe('east')
    expect(rotateDir('north', 270, 0)).toBe('up')
  })

  it('matches multipart conditions', () => {
    expect(conditionMatches({ north: 'true|tall' }, { north: 'tall' })).toBe(true)
    expect(conditionMatches({ OR: [{ east: 'true' }, { west: 'true' }] }, { west: 'true' })).toBe(true)
    expect(conditionMatches({ facing: '!north' }, { facing: 'north' })).toBe(false)
  })

  it('reproduces vanilla position seeds and java.util.Random', () => {
    // Expected values produced by the JVM (Mth.getSeed + new Random(seed).nextInt).
    expect(javaNextInt(42n, 10)).toBe(0)
    expect(javaNextInt(42n, 7)).toBe(1)
    expect(javaNextInt(-123456789n, 1000)).toBe(933)
    expect(positionSeed(1, 2, 3)).toBe(-33674130277896n)
    expect(positionSeed(-100, 64, 250)).toBe(-81216377325037n)
    expect(positionSeed(30000, -60, -29999)).toBe(24467533692823n)
    expect(javaNextInt(positionSeed(1, 2, 3), 4)).toBe(3)
  })
})

describe('Mesher', () => {
  const resolver = new ModelResolver(blockstates, models)
  const terrain = (blocks: number[], sx: number, sy: number, sz: number): TerrainData => ({
    sizeX: sx,
    sizeY: sy,
    sizeZ: sz,
    originX: 0,
    originY: 0,
    originZ: 0,
    palette: [
      { name: 'minecraft:air', properties: {} },
      { name: 'minecraft:stone', properties: {} },
      { name: 'minecraft:grass_block', properties: { snowy: 'false' } }
    ],
    blocks: Uint16Array.from(blocks),
    biomePalette: ['minecraft:plains'],
    biomes: new Uint16Array(sx * sz),
    dimension: 'overworld'
  })
  const biomes = { plains: { id: 'plains', temperature: 0.8, downfall: 0.4, effects: {} } }

  it('culls hidden faces between solid blocks', () => {
    const mesh = meshTerrain(terrain([1, 1, 1, 1, 1, 1, 1, 1], 2, 2, 2), resolver, () => slot, biomes, {
      grass: null,
      foliage: null
    })
    // A 2x2x2 cube exposes 6 sides × 4 faces = 24 quads.
    expect(mesh.opaque.indices.length / 6).toBe(24)
  })

  it('tints grass tops by biome and shades sides', () => {
    const map = { width: 256, height: 256, data: new Uint8Array(256 * 256 * 4) }
    const x = Math.floor((1 - 0.8) * 255)
    const y = Math.floor((1 - 0.4 * 0.8) * 255)
    map.data.set([0x91, 0xbd, 0x59, 255], (y * 256 + x) * 4)
    expect(sampleColormap(map, 0.8, 0.4, 0)).toBe(0x91bd59)
    expect(grassColor(biomes.plains, { grass: map, foliage: null })).toBe(0x91bd59)
    expect(blockTint('minecraft:grass_block', {}, 0, { grass: 1, foliage: 2, water: 3 })).toBe(1)
    expect(blockTint('minecraft:stone', {}, 0, { grass: 1, foliage: 2, water: 3 })).toBe(0xffffff)

    const mesh = meshTerrain(
      terrain([2], 1, 1, 1),
      resolver,
      () => slot,
      biomes,
      { grass: map, foliage: null },
      { ambientOcclusion: false, biomeBlend: 0 }
    )
    const { colors, normals } = mesh.opaque
    let topColor: number[] | null = null
    for (let i = 0; i < normals.length / 3; i++)
      if (normals[i * 3 + 1] > 0.9) topColor = Array.from(colors.slice(i * 3, i * 3 + 3))
    expect(topColor![0]).toBeCloseTo(Math.pow((0x91 / 255 + 0.055) / 1.055, 2.4), 4)
  })
})

describe('Player model', () => {
  it('maps the head front to the face region of the skin', () => {
    const head = playerParts(false)[0]
    const front = boxFaces(head.boxes[0])[0]
    expect(front.uv).toEqual([8, 8, 16, 16])
    const hatFront = boxFaces(head.boxes[1])[0]
    expect(hatFront.uv).toEqual([40, 8, 48, 16])
    const back = boxFaces(head.boxes[0])[1]
    expect(back.uv).toEqual([24, 8, 32, 16])
  })

  it('uses 3px arms for slim (Alex) skins', () => {
    const arm = playerParts(true).find((p) => p.name === 'rightArm')!.boxes[0]
    expect(arm.to[0] - arm.from[0]).toBe(3)
    expect(boxFaces(arm)[0].uv).toEqual([44, 20, 47, 26])
  })

  it('splits limbs at the elbow/knee without changing the unbent model', () => {
    const parts = playerParts(false)
    const upper = parts.find((p) => p.name === 'rightArm')!
    const lower = parts.find((p) => p.name === 'rightForearm')!
    expect(lower.parent).toBe('rightArm')
    expect(lower.pivot).toEqual([-1, -4, 0]) // middle of the arm, 6px below the top
    // Front faces cover the arm's 12 skin rows between them: 20–26 and 26–32.
    expect(boxFaces(upper.boxes[0])[0].uv).toEqual([44, 20, 48, 26])
    expect(boxFaces(lower.boxes[0])[0].uv).toEqual([44, 26, 48, 32])
    // In place, the lower box sits exactly under the upper one (arm spans y -10..2 around the shoulder).
    const y = (b: (typeof upper.boxes)[0], pivot: number[]): number[] => [b.from[1] + pivot[1], b.to[1] + pivot[1]]
    expect(y(upper.boxes[0], [0, 0, 0])).toEqual([-4, 2])
    expect(y(lower.boxes[0], lower.pivot)).toEqual([-10, -4])
    // The real shoulder top and hand bottom keep their skin faces; the cut ends are capped with the cut row.
    expect(boxFaces(upper.boxes[0])[4].uv).toEqual([44, 16, 48, 20])
    expect(boxFaces(upper.boxes[0])[5].uv).toEqual([44, 25, 48, 26])
    expect(boxFaces(lower.boxes[0])[5].uv).toEqual([48, 16, 52, 20])
  })

  it('fills in elbows and knees for poses saved before they existed', () => {
    const pose = fullPose({ rightArm: [10, 0, 0] } as Partial<Pose>)
    expect(pose.rightArm).toEqual([10, 0, 0])
    expect(pose.leftShin).toEqual([0, 0, 0])
    expect(Object.keys(POSES.Running)).toHaveLength(10)
  })

  it('converts legacy 64x32 skins by mirroring the right limbs', () => {
    const legacy = new Uint8ClampedArray(64 * 32 * 4)
    const put = (x: number, y: number, v: number): void => legacy.set([v, v, v, 255], (y * 64 + x) * 4)
    put(0, 20, 200) // outer edge of right leg's "right side" strip
    const out = normalizeSkin(legacy, 64, 32)
    // copyRect(0, 20, 24, 32, 4, 12, mirror) puts pixel (0,20) at (24+3, 52)
    expect(out[(52 * 64 + 27) * 4]).toBe(200)
    expect(out.length).toBe(64 * 64 * 4)
  })
})

describe('World generation helpers', () => {
  it('parses /locate output', () => {
    expect(
      parseLocate(
        '[12:00:00] [Server thread/INFO]: The nearest minecraft:desert is at [-1234, 72, 567] (1300 blocks away)'
      )
    ).toEqual({
      biome: 'minecraft:desert',
      x: -1234,
      y: 72,
      z: 567
    })
    expect(parseLocate('The nearest minecraft:plains is at [16, ~, -32] (40 blocks away)')?.y).toBeNull()
    expect(parseLocate('Unknown command')).toBeNull()
  })

  it('offers one biome per look, grouped by dimension', () => {
    const g = groupBiomes(['desert', 'old_growth_pine_taiga', 'the_void', 'crimson_forest', 'end_highlands', 'plains'])
    expect(g.overworld).toEqual(['plains', 'desert'])
    expect(g.the_nether).toEqual(['crimson_forest'])
    expect(g.the_end).toEqual(['end_highlands'])
  })
})

describe('entity categories', () => {
  it('keeps chests, boats and gear out of the mob list', async () => {
    const { entityCategory } = await import('@shared/minecraft/entityModels')
    const cases: [string, string][] = [
      ['minecraft:zombie#main', 'mobs'],
      ['minecraft:creeper#main', 'mobs'],
      ['minecraft:ender_dragon#main', 'bosses'],
      ['minecraft:chest#main', 'blocks'],
      ['minecraft:double_chest_left#main', 'blocks'],
      ['minecraft:sign/oak#main', 'blocks'],
      ['minecraft:hanging_sign/birch#main', 'blocks'],
      ['minecraft:decorated_pot_base#main', 'blocks'],
      ['minecraft:boat/oak#main', 'vehicles'],
      ['minecraft:chest_boat/cherry#main', 'vehicles'],
      ['minecraft:chest_minecart#main', 'vehicles'],
      ['minecraft:armor_stand#main', 'gear'],
      ['minecraft:trident#main', 'gear'],
      ['minecraft:arrow#main', 'effects'],
      ['minecraft:evoker_fangs#main', 'effects']
    ]
    for (const [key, cat] of cases) expect(entityCategory(key), key).toBe(cat)
  })
})
