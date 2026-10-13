import { useEffect, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'

const SHORTCUTS: [string, string][] = [
  ['Orbit · pan · zoom', 'Drag · right-drag · scroll'],
  ['Move · rotate · scale', 'W · E · R'],
  ['Snap while moving', 'Hold Shift'],
  ['Add to the selection', 'Ctrl-click · Shift-click'],
  ['Box-select', 'Shift-drag on empty space'],
  ['Deselect', 'Esc'],
  ['Undo · redo', 'Ctrl Z · Ctrl Y'],
  ['Duplicate · delete', 'Ctrl D · Del'],
  ['Group · ungroup', 'Ctrl G · Ctrl ⇧ G'],
  ['Select all', 'Ctrl A'],
  ['Save view · back to it', 'C'],
  ['Rulers and centre guides', 'Shift R'],
  ['Hide or show the side panels', '\\'],
  ['New · open · save', 'Ctrl N · Ctrl O · Ctrl S'],
  ['Next project tab', 'Ctrl Tab']
]

/** Every keyboard and mouse shortcut on one card. */
export function ShortcutsDialog({ onClose }: { onClose: () => void }): ReactNode {
  useEffect(() => {
    const key = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [onClose])
  return createPortal(
    <div className="about-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="about shortcuts" role="dialog" aria-label="Keyboard shortcuts">
        <header>
          <strong>Shortcuts</strong>
          <button className="icon-btn" title="Close (Esc)" onClick={onClose}>
            <X size={16} />
          </button>
        </header>
        <dl>
          {SHORTCUTS.map(([what, keys]) => (
            <div key={what}>
              <dt>{what}</dt>
              <dd>{keys}</dd>
            </div>
          ))}
        </dl>
      </div>
    </div>,
    document.body
  )
}
