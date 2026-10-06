// Runs the real ModelDumper against stub classes shaped like Minecraft's (Mojang-named), and against an
// "obfuscated" copy of those stubs driven by a ProGuard mapping file. Skipped when no JDK is installed.
import { execFileSync, spawnSync } from 'node:child_process'
import { cpSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, relative, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { namesFromMappings, partPaths, textureCandidates, type DumpedLayer } from '@shared/minecraft/entityModels'

const hasJavac = spawnSync('javac', ['-version']).status === 0
const hasJarsigner =
  hasJavac && spawnSync('jarsigner', ['-help']).status !== null && spawnSync('keytool', ['-help']).status !== null
const root = resolve(__dirname, '..')
const stubs = join(root, 'tests/fixtures/model-stubs')

function javaFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f)
    return statSync(p).isDirectory() ? javaFiles(p) : p.endsWith('.java') ? [p] : []
  })
}

function compile(src: string, out: string): void {
  execFileSync('javac', ['--release', '17', '-d', out, ...javaFiles(src)], { stdio: 'pipe' })
}

function dump(classes: string, names: string): { layers: Record<string, DumpedLayer> } {
  const work = mkdtempSync(join(tmpdir(), 'dumper-'))
  const dumper = join(work, 'dumper')
  compile(join(root, 'tools/model-dumper'), dumper)
  writeFileSync(join(work, 'names.properties'), names)
  const sep = process.platform === 'win32' ? ';' : ':'
  execFileSync(
    'java',
    ['-cp', [dumper, classes].join(sep), 'dev.blockframe.dumper.ModelDumper', 'names.properties', 'out.json'],
    {
      cwd: work,
      stdio: 'pipe'
    }
  )
  return JSON.parse(readFileSync(join(work, 'out.json'), 'utf8'))
}

function checkTestMob(layers: Record<string, DumpedLayer>): void {
  const mob = layers['minecraft:test_mob#main']
  expect(mob.texture).toEqual([64, 32])
  const head = mob.root.children.head
  expect(head.pivot).toEqual([0, 6, 0])
  expect(head.rot[0]).toBeCloseTo(0.5)
  expect(head.quads[0].n).toEqual([0, 0, -1])
  expect(head.quads[0].v[0]).toEqual([-4, -8, -4, 0.125, 0.25])
  // A layer that throws while baking is skipped, not fatal.
  expect(layers['minecraft:broken#main']).toBeUndefined()
}

describe.skipIf(!hasJavac)('ModelDumper', () => {
  it('exports baked model parts from Mojang-named classes', () => {
    const classes = mkdtempSync(join(tmpdir(), 'stubs-'))
    compile(stubs, classes)
    checkTestMob(dump(classes, '').layers)
  })

  it('follows ProGuard mappings for obfuscated jars', () => {
    // Rename the stub classes/members the way an obfuscated client would, then map them back.
    const src = mkdtempSync(join(tmpdir(), 'obf-src-'))
    cpSync(stubs, src, { recursive: true })
    const renames: [string, string][] = [
      ['LayerDefinitions', 'Zq'],
      ['createRoots', 'a'],
      ['bakeRoot', 'b'],
      ['xRot', 'r1']
    ]
    for (const file of javaFiles(src)) {
      let text = readFileSync(file, 'utf8')
      for (const [from, to] of renames) text = text.replace(new RegExp(`\\b${from}\\b`, 'g'), to)
      const rel = relative(src, file).replace(/\bLayerDefinitions\.java$/, 'Zq.java')
      const target = join(src, rel)
      mkdirSync(join(target, '..'), { recursive: true })
      writeFileSync(target, text)
    }
    // Remove the original-named file so only the "obfuscated" class exists.
    const orig = join(src, 'net/minecraft/client/model/geom/LayerDefinitions.java')
    writeFileSync(orig, '')
    const classes = mkdtempSync(join(tmpdir(), 'obf-'))
    compile(src, classes)

    const mappings = [
      '# comment',
      'net.minecraft.client.model.geom.LayerDefinitions -> net.minecraft.client.model.geom.Zq:',
      '    12:40:java.util.Map createRoots():51:79 -> a',
      'net.minecraft.client.model.geom.builders.LayerDefinition -> net.minecraft.client.model.geom.builders.LayerDefinition:',
      '    net.minecraft.client.model.geom.builders.MaterialDefinition material -> material',
      '    1:1:net.minecraft.client.model.geom.ModelPart bakeRoot():5:5 -> b',
      '    1:1:net.minecraft.client.model.geom.ModelPart bakeRoot(int):5:5 -> c',
      'net.minecraft.client.model.geom.ModelPart -> net.minecraft.client.model.geom.ModelPart:',
      '    float xRot -> r1',
      'some.other.Clazz -> q:',
      '    float xRot -> zz'
    ].join('\n')
    const names = namesFromMappings(mappings)
    expect(names).toContain('class.net.minecraft.client.model.geom.LayerDefinitions=net.minecraft.client.model.geom.Zq')
    expect(names).toContain('member.net.minecraft.client.model.geom.builders.LayerDefinition.bakeRoot=b')
    expect(names).not.toContain('=c')
    expect(names).not.toContain('zz')
    checkTestMob(dump(classes, names).layers)
  })
})

describe.skipIf(!hasJarsigner)('ModelDumper with a signed, obfuscated client', () => {
  it('loads root-package classes from a signed jar (like Mojang 1.21 clients)', () => {
    // The real 1.21 client jar is signed and its obfuscated classes (e.g. "fyh") live in the unnamed
    // package. If the dumper also lived there, the JVM would throw a SecurityException
    // ("signer information does not match").
    const src = mkdtempSync(join(tmpdir(), 'signed-src-'))
    cpSync(stubs, src, { recursive: true })
    const ld = join(src, 'net/minecraft/client/model/geom/LayerDefinitions.java')
    const body = readFileSync(ld, 'utf8')
      .replace(/^package [^;]+;/m, 'import net.minecraft.client.model.geom.*;')
      .replace(/\bclass LayerDefinitions\b/, 'class Fyh')
    writeFileSync(join(src, 'Fyh.java'), body)
    writeFileSync(ld, '')
    const classes = mkdtempSync(join(tmpdir(), 'signed-cls-'))
    compile(src, classes)
    const work = mkdtempSync(join(tmpdir(), 'signed-jar-'))
    const jar = join(work, 'client.jar')
    execFileSync('jar', ['cf', jar, '-C', classes, '.'], { stdio: 'pipe' })
    const ks = join(work, 'ks.jks')
    execFileSync(
      'keytool',
      [
        '-genkeypair',
        '-alias',
        'mojang',
        '-keyalg',
        'RSA',
        '-keystore',
        ks,
        '-storepass',
        'secret',
        '-keypass',
        'secret',
        '-dname',
        'CN=test',
        '-validity',
        '2'
      ],
      { stdio: 'pipe' }
    )
    execFileSync('jarsigner', ['-keystore', ks, '-storepass', 'secret', jar, 'mojang'], { stdio: 'pipe' })
    const names = 'class.net.minecraft.client.model.geom.LayerDefinitions=Fyh\n'
    checkTestMob(dump(jar, names).layers)
  })
})

describe('entity model helpers', () => {
  const layer: DumpedLayer = {
    texture: [64, 32],
    root: {
      pivot: [0, 0, 0],
      rot: [0, 0, 0],
      scale: [1, 1, 1],
      visible: true,
      quads: [],
      children: {
        head: {
          pivot: [0, 0, 0],
          rot: [0, 0, 0],
          scale: [1, 1, 1],
          visible: true,
          quads: [],
          children: {
            hat: { pivot: [0, 0, 0], rot: [0, 0, 0], scale: [1, 1, 1], visible: true, quads: [], children: {} }
          }
        },
        body: { pivot: [0, 0, 0], rot: [0, 0, 0], scale: [1, 1, 1], visible: true, quads: [], children: {} }
      }
    }
  }

  it('lists part paths', () => {
    expect(partPaths(layer.root)).toEqual(['head', 'head/hat', 'body'])
  })

  it('ranks real entity textures by name and UV size', () => {
    const sizes: Record<string, [number, number]> = {
      'entity/zombie/zombie': [64, 64],
      'entity/zombie/husk': [64, 64],
      'entity/creeper/creeper': [64, 32],
      'entity/creeper/creeper_armor': [64, 32],
      'entity/cow/cow': [64, 32]
    }
    expect(textureCandidates('minecraft:creeper#main', layer, sizes)[0]).toBe('entity/creeper/creeper')
    // Wrong aspect ratio is never offered.
    expect(textureCandidates('minecraft:zombie#main', layer, sizes)).toEqual([])
    expect(textureCandidates('minecraft:zombie#main', { ...layer, texture: [64, 64] }, sizes)[0]).toBe(
      'entity/zombie/zombie'
    )
  })
})

describe('renderer textures', () => {
  const layer = (w: number, h: number): DumpedLayer => ({
    texture: [w, h],
    root: { pivot: [0, 0, 0], rot: [0, 0, 0], scale: [1, 1, 1], visible: true, quads: [], children: {} }
  })
  it('uses the texture the game pairs with the model, not just a name match', () => {
    const sizes: Record<string, [number, number]> = {
      'entity/slime/magmacube': [64, 32],
      'entity/slime/slime': [64, 32],
      'entity/boat/oak': [128, 64],
      'entity/chest_boat/oak': [128, 128],
      'entity/chest/normal': [64, 64]
    }
    expect(textureCandidates('minecraft:magma_cube#main', layer(64, 32), sizes)[0]).toBe('entity/slime/magmacube')
    expect(textureCandidates('minecraft:boat/oak#main', layer(128, 64), sizes)[0]).toBe('entity/boat/oak')
    expect(textureCandidates('minecraft:chest_boat/oak#main', layer(128, 128), sizes)[0]).toBe('entity/chest_boat/oak')
  })
})

describe('mob pose presets', () => {
  it('builds poses from part names and skips ones the mob lacks', async () => {
    const { mobPosePresets, mainParts } = await import('@shared/minecraft/entityModels')
    const dragon = [
      'head',
      'head/jaw',
      'neck',
      'body',
      'right_wing',
      'right_wing/right_wing_tip',
      'left_wing',
      'left_front_leg',
      'right_hind_leg',
      'tail'
    ]
    const labels = mobPosePresets(dragon).map((p) => p.label)
    expect(labels).toContain('Wings up')
    expect(labels).toContain('Walk')
    expect(labels).not.toContain('Reach') // no arms
    const wings = mobPosePresets(dragon).find((p) => p.label === 'Wings up')!.rotations
    expect(wings.right_wing[2]).toBe(-wings.left_wing[2]) // mirrored
    expect(mainParts(dragon)).toEqual([
      'head',
      'neck',
      'body',
      'right_wing',
      'left_wing',
      'left_front_leg',
      'right_hind_leg',
      'tail'
    ])
  })
})
