import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: {}, net: {} }))
vi.mock('electron-updater', () => ({ autoUpdater: {} }))

describe('newerVersion', async () => {
  const { newerVersion } = await import('../src/main/updates')
  it('compares dotted versions numerically', () => {
    expect(newerVersion('v0.2.10', '0.2.9')).toBe(true)
    expect(newerVersion('0.2.9', '0.2.10')).toBe(false)
    expect(newerVersion('v1.0.0', '1.0.0')).toBe(false)
    expect(newerVersion('1.1', '1.0.5')).toBe(true)
  })
})
