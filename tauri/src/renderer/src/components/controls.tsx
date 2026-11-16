import { useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { ChevronLeft, ChevronRight, CircleHelp } from 'lucide-react'

/**
 * A number field that keeps what's being typed ("-", "0.", an empty box) instead of snapping to the store's
 * value mid-edit; the store gets every valid number, and the field shows the rounded value again on blur.
 */
export function NumberInput({
  value,
  onChange,
  step,
  min,
  digits = 2
}: {
  value: number
  onChange: (v: number) => void
  step?: number
  min?: number
  digits?: number
}): ReactNode {
  const [draft, setDraft] = useState<string | null>(null)
  const f = 10 ** digits
  return (
    <input
      type="number"
      step={step}
      min={min}
      value={draft ?? String(Math.round(value * f) / f)}
      onChange={(e) => {
        setDraft(e.target.value)
        const n = e.target.valueAsNumber
        if (Number.isFinite(n)) onChange(min === undefined ? n : Math.max(min, n))
      }}
      onBlur={() => setDraft(null)}
    />
  )
}

/**
 * A number shown as plain text: drag it left/right to change it (hold Shift for fine steps), or click to
 * type a value. Compact enough for a row of X/Y/Z values on one line.
 */
export function ScrubNumber({
  value,
  onChange,
  step = 1,
  min,
  max,
  digits = 1,
  suffix = '',
  label,
  axis,
  title
}: {
  value: number
  onChange: (v: number) => void
  step?: number
  min?: number
  max?: number
  digits?: number
  suffix?: string
  /** Short label before the value (an axis letter, "Bend"…). */
  label?: string
  /** Colours the label like the viewport gizmo's axes. */
  axis?: 'x' | 'y' | 'z'
  title?: string
}): ReactNode {
  const [editing, setEditing] = useState(false)
  const drag = useRef<{ x: number; v: number; moved: boolean } | null>(null)
  const f = 10 ** digits
  const shown = Math.round(value * f) / f
  const clamp = (v: number): number => Math.min(max ?? Infinity, Math.max(min ?? -Infinity, v))
  if (editing)
    return (
      <span className="scrub editing">
        {label && <em className={axis ? `axis-${axis}` : undefined}>{label}</em>}
        <input
          autoFocus
          defaultValue={String(shown)}
          onFocus={(e) => e.target.select()}
          onBlur={(e) => {
            const n = Number(e.target.value)
            if (e.target.value.trim() !== '' && Number.isFinite(n)) onChange(clamp(n))
            setEditing(false)
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') e.currentTarget.blur()
            if (e.key === 'Escape') setEditing(false)
          }}
        />
      </span>
    )
  return (
    <span
      className="scrub"
      title={title ?? 'Drag to change (Shift for fine steps), click to type'}
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId)
        drag.current = { x: e.clientX, v: value, moved: false }
      }}
      onPointerMove={(e) => {
        const d = drag.current
        if (!d) return
        const dx = e.clientX - d.x
        if (!d.moved && Math.abs(dx) < 3) return
        d.moved = true
        // About four pixels per step; Shift for tenths.
        const v = d.v + Math.round(dx / 4) * step * (e.shiftKey ? 0.1 : 1)
        onChange(clamp(Math.round(v * f) / f))
      }}
      onPointerUp={() => {
        if (drag.current && !drag.current.moved) setEditing(true)
        drag.current = null
      }}
      onPointerCancel={() => (drag.current = null)}
      onLostPointerCapture={() => (drag.current = null)}
    >
      {label && <em className={axis ? `axis-${axis}` : undefined}>{label}</em>}
      {shown}
      {suffix}
    </span>
  )
}

/** A label and three scrub values (X/Y/Z) on one line. */
export function NumberRow({
  label,
  value,
  onChange,
  step = 0.1,
  digits = 2,
  suffix = '',
  active,
  onLabelClick
}: {
  label: string
  value: [number, number, number]
  onChange: (v: [number, number, number]) => void
  step?: number
  digits?: number
  suffix?: string
  active?: boolean
  onLabelClick?: () => void
}): ReactNode {
  return (
    <div className={`vec-row ${active ? 'active' : ''}`}>
      <span className={onLabelClick ? 'clickable' : undefined} onClick={onLabelClick}>
        {label}
      </span>
      {(['x', 'y', 'z'] as const).map((axis, i) => (
        <ScrubNumber
          key={axis}
          axis={axis}
          label={axis.toUpperCase()}
          step={step}
          digits={digits}
          suffix={suffix}
          value={value[i]}
          onChange={(n) => {
            const next = [...value] as [number, number, number]
            next[i] = n
            onChange(next)
          }}
        />
      ))}
    </div>
  )
}

export const readFlag = (key: string, dflt: boolean): boolean => {
  try {
    const v = localStorage.getItem(key)
    return v === null ? dflt : v === '1'
  } catch {
    return dflt
  }
}
export const writeFlag = (key: string, on: boolean): void => {
  try {
    localStorage.setItem(key, on ? '1' : '0')
  } catch {
    /* storage unavailable */
  }
}

/**
 * A collapsible group of related controls inside a panel. Secondary settings start closed so each panel
 * shows the few things most people change; the open/closed state is remembered per group.
 */
export function Group({
  id,
  title,
  icon,
  defaultOpen = false,
  aside,
  children
}: {
  id: string
  title: ReactNode
  icon?: ReactNode
  defaultOpen?: boolean
  /** Shown on the right of the title row (a toggle, a count). Clicks on it don't fold the group. */
  aside?: ReactNode
  children: ReactNode
}): ReactNode {
  const [open, setOpen] = useState(() => readFlag(`group:${id}`, defaultOpen))
  return (
    <div className={`group ${open ? 'open' : ''}`}>
      <div className="group-head">
        <button
          className="group-toggle"
          aria-expanded={open}
          onClick={() => {
            setOpen(!open)
            writeFlag(`group:${id}`, !open)
          }}
        >
          <ChevronRight size={14} className="chev" />
          {icon}
          <span>{title}</span>
        </button>
        {aside && (
          <div className="group-aside" onClick={(e) => e.stopPropagation()}>
            {aside}
          </div>
        )}
      </div>
      {open && <div className="group-body">{children}</div>}
    </div>
  )
}

/** Help text folded behind a small "?" so panels stay short; one click shows it. */
export function Hint({ children, label = 'How this works' }: { children: ReactNode; label?: string }): ReactNode {
  const [open, setOpen] = useState(false)
  return (
    <div className={`tip ${open ? 'open' : ''}`}>
      <button className="tip-toggle" onClick={() => setOpen(!open)} aria-expanded={open}>
        <CircleHelp size={13} />
        <span>{label}</span>
      </button>
      {open && <p>{children}</p>}
    </div>
  )
}

/** An on/off switch with its label. */
export function Toggle({
  label,
  checked,
  onChange,
  title
}: {
  label: ReactNode
  checked: boolean
  onChange: (on: boolean) => void
  title?: string
}): ReactNode {
  return (
    <label className="toggle" title={title}>
      <span>{label}</span>
      <input type="checkbox" role="switch" checked={checked} onChange={(e) => onChange(e.target.checked)} />
    </label>
  )
}

/** A labelled slider: name and value on one line, a full-width track underneath. */
export function Slider({
  label,
  value,
  min,
  max,
  step = 1,
  onChange,
  format = (v) => String(Math.round(v * 100) / 100),
  title
}: {
  label: ReactNode
  value: number
  min: number
  max: number
  step?: number
  onChange: (v: number) => void
  format?: (v: number) => string
  title?: string
}): ReactNode {
  return (
    <label className="field slider" title={title}>
      <span>{label}</span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
      />
      <em>{format(value)}</em>
    </label>
  )
}

/**
 * A colour-coded, collapsible top-level section of a tab (Look, Mobs, Builds…). Remembers whether it's open;
 * its contents are only built while open, so closed sections cost nothing.
 */
export function ColorSection({
  id,
  title,
  color,
  count,
  defaultOpen = false,
  children
}: {
  /** Unique across the app (it keys the remembered open state). */
  id: string
  title: string
  color: string
  count?: number
  defaultOpen?: boolean
  children: ReactNode
}): ReactNode {
  const [open, setOpen] = useState(() => readFlag(`section:${id}`, defaultOpen))
  const style = { '--section': color } as CSSProperties
  return (
    <section className={`fx-section ${open ? 'open' : ''}`} style={style}>
      <button
        className="fx-section-head"
        aria-expanded={open}
        onClick={() => {
          setOpen(!open)
          writeFlag(`section:${id}`, !open)
        }}
      >
        <span className="fx-section-dot" />
        <span>{title}</span>
        {count !== undefined && <span className="fx-section-count">{count}</span>}
        <ChevronRight size={14} className="chev" />
      </button>
      {open && <div className="fx-section-body">{children}</div>}
    </section>
  )
}

/** Lists longer than this open in pages instead of one long scroll. */
export const PAGE_WHEN_OVER = 50
/** Tiles per page in a paged list. */
export const PAGE_SIZE = 12

/**
 * Splits `items` into pages of {@link PAGE_SIZE} once the list (or `count`, when the section's badge counts
 * something else) is over {@link PAGE_WHEN_OVER}; shorter lists come back whole. Goes back to the first page
 * whenever the list itself changes (a new search, another biome).
 */
export function usePaged<T>(
  items: T[],
  count = items.length
): { shown: T[]; page: number; pages: number; setPage: (p: number) => void } {
  const [state, setState] = useState({ items, page: 0 })
  const paged = count > PAGE_WHEN_OVER
  const pages = paged ? Math.max(1, Math.ceil(items.length / PAGE_SIZE)) : 1
  const page = state.items === items ? Math.min(state.page, pages - 1) : 0
  const setPage = (p: number): void => setState({ items, page: Math.max(0, Math.min(pages - 1, p)) })
  return { shown: paged ? items.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE) : items, page, pages, setPage }
}

/** The page numbers to offer: always the first and last, the current one and its neighbours, gaps as null. */
export const pageButtons = (page: number, pages: number): (number | null)[] => {
  const keep = new Set([0, pages - 1, page - 1, page, page + 1].filter((p) => p >= 0 && p < pages))
  // A gap of one page is shown as that page rather than as "…".
  for (const p of [1, pages - 2]) if (keep.has(p - 1) && keep.has(p + 1)) keep.add(p)
  const out: (number | null)[] = []
  ;[...keep]
    .sort((a, b) => a - b)
    .forEach((p, i, all) => {
      if (i && p - all[i - 1] > 1) out.push(null)
      out.push(p)
    })
  return out
}

/** The page selector at the foot of a paged list; nothing when the list fits on one page. */
export function Pager({
  page,
  pages,
  setPage
}: {
  page: number
  pages: number
  setPage: (p: number) => void
}): ReactNode {
  if (pages < 2) return null
  return (
    <nav className="pager" aria-label="Pages">
      <button className="pager-step" disabled={page === 0} onClick={() => setPage(page - 1)} title="Previous page">
        <ChevronLeft size={14} />
      </button>
      {pageButtons(page, pages).map((p, i) =>
        p === null ? (
          <span key={`gap${i}`} className="pager-gap">
            …
          </span>
        ) : (
          <button
            key={p}
            className={p === page ? 'active' : ''}
            aria-current={p === page ? 'page' : undefined}
            onClick={() => setPage(p)}
          >
            {p + 1}
          </button>
        )
      )}
      <button className="pager-step" disabled={page === pages - 1} onClick={() => setPage(page + 1)} title="Next page">
        <ChevronRight size={14} />
      </button>
    </nav>
  )
}
