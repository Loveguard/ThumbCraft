import { describe, expect, it } from 'vitest'
import { CLAUDE_TOOLS } from '../src/shared/claudeTools'

describe('Claude tools', () => {
  it('have unique names that MCP clients accept', () => {
    const names = CLAUDE_TOOLS.map((t) => t.name)
    expect(new Set(names).size).toBe(names.length)
    for (const n of names) expect(n).toMatch(/^[a-z][a-z0-9_]{0,63}$/)
  })
  it('describe their input as JSON Schema objects', () => {
    for (const t of CLAUDE_TOOLS) {
      expect(t.inputSchema.type).toBe('object')
      expect(t.description.length).toBeGreaterThan(20)
      const props = (t.inputSchema.properties ?? {}) as Record<string, unknown>
      for (const r of (t.inputSchema.required ?? []) as string[]) expect(props).toHaveProperty(r)
    }
  })
})
