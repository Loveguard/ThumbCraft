// Fonts installed on this computer, searchable, each shown in its own face. Picking one embeds its file in the
// project (like an imported font), so the title looks the same on a computer without that font.
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import type { SystemFont } from '@shared/api'
import { mediaStore, registerMedia } from '../media'

let fonts: Promise<SystemFont[]> | null = null

/** Embeds a system font in the project (reusing it when this project already has it). Returns its media id. */
export async function embedSystemFont(f: SystemFont): Promise<string> {
  const name = `${f.full}.ttf`
  for (const m of mediaStore.values()) if (m.name === name && m.mime === 'font/ttf') return m.id
  const bytes = await window.blockframe.readSystemFont(f.path, f.index)
  return registerMedia(name, 'font/ttf', bytes).id
}

export function SystemFonts({ onPick }: { onPick: (mediaId: string) => void }): ReactNode {
  const [list, setList] = useState<SystemFont[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  useEffect(() => {
    fonts ??= window.blockframe.listSystemFonts().catch((e) => {
      fonts = null
      throw e
    })
    fonts.then(setList, (e: Error) => setError(e.message))
  }, [])
  const shown = useMemo(() => {
    // Every typed word must appear, in any order ("bold arial" finds Arial Bold).
    const words = query.toLowerCase().split(/\s+/).filter(Boolean)
    return (list ?? []).filter((f) => words.every((w) => f.full.toLowerCase().includes(w))).slice(0, 300)
  }, [list, query])

  return (
    <div className="system-fonts">
      <input
        type="search"
        placeholder={list ? `Search ${list.length} fonts on this computer` : 'Looking for fonts…'}
        value={query}
        autoFocus
        onChange={(e) => setQuery(e.target.value)}
      />
      {error && <p className="hint">Could not list fonts: {error}</p>}
      <div className="system-font-list">
        {shown.map((f) => (
          <button
            key={`${f.path}#${f.index}`}
            title={f.full}
            disabled={!!busy}
            onClick={async () => {
              setBusy(f.full)
              try {
                onPick(await embedSystemFont(f))
              } catch (e) {
                setError((e as Error).message)
              } finally {
                setBusy(null)
              }
            }}
          >
            <span
              style={{
                fontFamily: `"${f.family}", sans-serif`,
                fontStyle: /italic|oblique/i.test(f.style) ? 'italic' : undefined,
                fontWeight: /black|heavy/i.test(f.style) ? 900 : /bold/i.test(f.style) ? 700 : undefined
              }}
            >
              {f.full}
            </span>
            {busy === f.full && <em>adding…</em>}
          </button>
        ))}
        {list && !shown.length && <p className="hint">No font matches “{query}”.</p>}
      </div>
    </div>
  )
}
