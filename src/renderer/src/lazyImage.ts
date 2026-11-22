import { useEffect, useRef, useState, type DependencyList, type RefObject } from 'react'

/**
 * An image made only once its element scrolls into view (biome previews, mob icons): returns the ref to put on
 * the element and the image's URL, null until it is made.
 */
export function useLazyImage<T extends Element>(
  make: () => Promise<string | null> | undefined,
  deps: DependencyList
): [RefObject<T | null>, string | null] {
  const ref = useRef<T>(null)
  const [src, setSrc] = useState<string | null>(null)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    let alive = true
    const io = new IntersectionObserver(([e]) => {
      if (!e.isIntersecting) return
      io.disconnect()
      void make()?.then((u) => alive && setSrc(u))
    })
    io.observe(el)
    return () => {
      alive = false
      io.disconnect()
    }
    // `make` is a new function each render: `deps` say when what it makes changes.
  }, deps)
  return [ref, src]
}
