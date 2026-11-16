// The font dropdown: ThumbCraft's own fonts, fonts already in the project, and every font installed on this
// computer, in one searchable list, each shown in its own face. Picking a computer font embeds its file in the
// project (like an imported font), so the title looks the same on a computer without that font.
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { ChevronDown, Upload } from 'lucide-react'
import type { SystemFont } from '@shared/api'
import { mediaStore, registerFile, registerMedia } from '../media'
import { FONTS } from '../textStyles'
import { useDismiss } from '../useDismiss'

let fonts: Promise<SystemFont[]> | null = null

/** Embeds a system font in the project (reusing it when this project already has it). Returns its media id. */
export async function embedSystemFont(f: SystemFont): Promise<string> {
  const name = `${f.full}.ttf`
  for (const m of mediaStore.values()) if (m.name === name && m.mime === 'font/ttf') return m.id
  const bytes = await window.blockframe.readSystemFont(f.path, f.index)
  return registerMedia(name, 'font/ttf', bytes).id
}

const FONT_FILES = '.ttf,.otf,.woff,.woff2'

export interface FontChoice {
  /** What the text object stores: a bundled font's CSS family, or `media:<id>` for an embedded file. */
  value: string
  label: string
  /** CSS font-family the row is drawn in. */
  css: string
}

const faceOf = (style: string): { fontStyle?: string; fontWeight?: number } => ({
  fontStyle: /italic|oblique/i.test(style) ? 'italic' : undefined,
  fontWeight: /black|heavy/i.test(style) ? 900 : /bold/i.test(style) ? 700 : undefined
})

export function FontPicker({
  value,
  label,
  imported,
  onPick,
  onFile
}: {
  /** The current font's value (see `FontChoice`). */
  value: string
  /** Its name, shown on the closed dropdown. */
  label: string
  /** Fonts already embedded in this project. */
  imported: FontChoice[]
  onPick: (value: string) => void
  /** A font file chosen from disk. */
  onFile: (mediaId: string) => void
}): ReactNode {
  const [open, setOpen] = useState(false)
  const [list, setList] = useState<SystemFont[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const root = useRef<HTMLDivElement>(null)
  const file = useRef<HTMLInputElement>(null)
  useDismiss(
    root,
    () => setOpen(false),
    (el) => el
  )

  useEffect(() => {
    if (!open) return
    fonts ??= window.blockframe.listSystemFonts().catch((e) => {
      fonts = null
      throw e
    })
    fonts.then(setList, (e: Error) => setError(e.message))
  }, [open])

  const match = (name: string): boolean => {
    // Every typed word must appear, in any order ("bold arial" finds Arial Bold).
    const words = query.toLowerCase().split(/\s+/).filter(Boolean)
    return words.every((w) => name.toLowerCase().includes(w))
  }
  const bundled = FONTS.filter((f) => match(f.label))
  const inProject = imported.filter((f) => match(f.label))
  const computer = useMemo(
    () => (list ?? []).filter((f) => match(f.full)).slice(0, 300),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [list, query]
  )

  const pick = (v: string): void => {
    onPick(v)
    setOpen(false)
    setQuery('')
  }
  const row = (key: string, text: string, css: string, active: boolean, on: () => void, style?: object): ReactNode => (
    <button key={key} className={active ? 'active' : ''} title={text} disabled={!!busy} onClick={on}>
      <span style={{ fontFamily: css, ...style }}>{text}</span>
      {busy === text && <em>adding…</em>}
    </button>
  )

  return (
    <div className="font-picker" ref={root}>
      <button className="font-current" aria-haspopup="listbox" aria-expanded={open} onClick={() => setOpen(!open)}>
        <span>{label}</span>
        <ChevronDown size={14} />
      </button>
      {open && (
        <div className="font-menu" role="listbox">
          <input
            type="search"
            placeholder={list ? `Search ${FONTS.length + list.length} fonts` : 'Search fonts'}
            value={query}
            autoFocus
            onChange={(e) => setQuery(e.target.value)}
          />
          <div className="font-list">
            {inProject.length > 0 && <h5>In this project</h5>}
            {inProject.map((f) => row(f.value, f.label, f.css, f.value === value, () => pick(f.value)))}
            {bundled.length > 0 && <h5>ThumbCraft</h5>}
            {bundled.map((f) => row(f.label, f.label, f.family, f.family === value, () => pick(f.family)))}
            {(computer.length > 0 || !list) && <h5>On this computer</h5>}
            {!list && !error && <p className="hint">Looking for fonts…</p>}
            {computer.map((f) =>
              row(
                f.full,
                f.full,
                `"${f.family}", sans-serif`,
                false,
                async () => {
                  setBusy(f.full)
                  try {
                    pick(`media:${await embedSystemFont(f)}`)
                  } catch (e) {
                    setError((e as Error).message)
                  } finally {
                    setBusy(null)
                  }
                },
                faceOf(f.style)
              )
            )}
            {error && <p className="hint">Could not list fonts: {error}</p>}
            {list && !bundled.length && !inProject.length && !computer.length && (
              <p className="hint">No font matches “{query}”.</p>
            )}
          </div>
          <button className="font-import" onClick={() => file.current?.click()}>
            <Upload size={14} /> Import a font file…
          </button>
        </div>
      )}
      <input
        ref={file}
        type="file"
        accept={FONT_FILES}
        hidden
        onChange={async (e) => {
          const f = e.target.files?.[0]
          e.target.value = ''
          if (!f) return
          const media = await registerFile(f)
          if (media) {
            onFile(media.id)
            setOpen(false)
          }
        }}
      />
    </div>
  )
}
