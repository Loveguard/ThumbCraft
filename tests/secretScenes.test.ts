import { existsSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import anchors from '../resources/secret/anchors.json'

const dir = join(__dirname, '..', 'resources', 'secret')

describe('secret scene models', () => {
  it('every anchored model ships as a .glb, served by the main process', () => {
    const main = readFileSync(join(__dirname, '..', 'src', 'main', 'index.ts'), 'utf8')
    for (const name of Object.keys(anchors)) {
      const file = join(dir, `${name}.glb`)
      expect(existsSync(file), name).toBe(true)
      // glTF binary magic
      expect(readFileSync(file).subarray(0, 4).toString(), name).toBe('glTF')
      expect(main, name).toContain(`'${name}.glb'`)
    }
  })

  it('stays small enough to ship with the app', () => {
    for (const name of Object.keys(anchors)) expect(statSync(join(dir, `${name}.glb`)).size, name).toBeLessThan(6e6)
  })
})
