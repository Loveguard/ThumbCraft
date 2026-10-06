import { describe, expect, it } from 'vitest'
import { readTar, safeRelative } from '@shared/tar'

/** Builds a tar with one header per entry (enough for testing the reader). */
function tar(entries: { name: string; data?: string; flag?: string; mode?: number; link?: string }[]): Uint8Array {
  const blocks: Uint8Array[] = []
  for (const e of entries) {
    const data = new TextEncoder().encode(e.data ?? '')
    const h = new Uint8Array(512)
    const put = (s: string, at: number): void => h.set(new TextEncoder().encode(s), at)
    put(e.name, 0)
    put((e.mode ?? 0o644).toString(8).padStart(7, '0'), 100)
    put(data.length.toString(8).padStart(11, '0'), 124)
    put(e.flag ?? '0', 156)
    if (e.link) put(e.link, 157)
    put('ustar', 257)
    blocks.push(h)
    const body = new Uint8Array(Math.ceil(data.length / 512) * 512)
    body.set(data)
    blocks.push(body)
  }
  blocks.push(new Uint8Array(1024))
  const out = new Uint8Array(blocks.reduce((n, b) => n + b.length, 0))
  let at = 0
  for (const b of blocks) out.set(b, (at += b.length) - b.length)
  return out
}

describe('readTar', () => {
  it('reads files, folders, symlinks, modes and long names', () => {
    const long = `jdk/${'x'.repeat(120)}/bin/java`
    const entries = readTar(
      tar([
        { name: 'jdk/', flag: '5' },
        { name: 'jdk/release', data: 'JAVA_VERSION="21"' },
        { name: 'jdk/bin/java', data: 'ELF', mode: 0o755 },
        { name: 'jdk/lib/link', flag: '2', link: '../bin/java' },
        { name: '././@LongLink', flag: 'L', data: long },
        { name: 'truncated', data: 'long' }
      ])
    )
    expect(entries.map((e) => [e.path, e.type])).toEqual([
      ['jdk/', 'dir'],
      ['jdk/release', 'file'],
      ['jdk/bin/java', 'file'],
      ['jdk/lib/link', 'symlink'],
      [long, 'file']
    ])
    expect(new TextDecoder().decode(entries[1].data)).toBe('JAVA_VERSION="21"')
    expect(entries[2].mode).toBe(0o755)
    expect(entries[3].link).toBe('../bin/java')
  })

  it('refuses paths that escape the target folder', () => {
    expect(safeRelative('jdk/bin/java')).toBe('jdk/bin/java')
    expect(safeRelative('../etc/passwd')).toBeNull()
    expect(safeRelative('/etc/passwd')).toBeNull()
    expect(safeRelative('C:\\Windows\\x')).toBeNull()
    expect(safeRelative('jdk/../../x')).toBeNull()
  })
})
