import { app } from 'electron'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { writeAtomic } from './projects'

interface Settings {
  lastJar?: string
  eulaAccepted?: boolean
  /** Seed of the world used when no seed is typed (kept so the generator never restarts for it). */
  genSeed?: string
  /** Resource packs over the vanilla textures, top (winning) pack first. */
  resourcePacks?: { path: string; enabled: boolean }[]
  /** false turns off the local server that lets Claude work in the app (on unless set). */
  claudeBridge?: boolean
}

const file = (): string => join(app.getPath('userData'), 'settings.json')

export function readSettings(): Settings {
  try {
    return existsSync(file()) ? (JSON.parse(readFileSync(file(), 'utf8')) as Settings) : {}
  } catch {
    return {}
  }
}

export function updateSettings(patch: Partial<Settings>): void {
  // Atomic, so a crash mid-write can't reset the EULA tick and the generator's default world.
  writeAtomic(file(), new TextEncoder().encode(JSON.stringify({ ...readSettings(), ...patch }, null, 2)))
}
