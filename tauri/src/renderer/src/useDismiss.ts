import { useEffect, type RefObject } from 'react'

/**
 * Closes a popover on a click outside it or on Escape. `area` is what counts as inside (by default the popover's
 * parent, so the button that opened it can toggle it shut instead of closing and reopening it).
 */
export function useDismiss(
  ref: RefObject<HTMLElement | null>,
  onClose: () => void,
  area: (el: HTMLElement) => Element | null = (el) => el.parentElement,
  active = true
): void {
  useEffect(() => {
    if (!active) return
    const away = (e: MouseEvent): void => {
      const el = ref.current
      const inside = el && (area(el) ?? el)
      if (inside && !inside.contains(e.target as Node)) onClose()
    }
    const key = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('mousedown', away)
    window.addEventListener('keydown', key)
    return () => {
      window.removeEventListener('mousedown', away)
      window.removeEventListener('keydown', key)
    }
    // `area` is a fixed lookup; re-binding on every render would be needless.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ref, onClose, active])
}
