// The clock that weather, effects and lightning move by. In Animation mode it is the timeline's time (so a paused
// frame, the playback and the exported video all show the same moment); for a thumbnail it stands still.

/** Seconds into the animation, shared by every effect's shader. */
export const EFFECT_TIME = { value: 0 }
/** 1 while the scene is animated, 0 for a still thumbnail. */
export const EFFECT_MOVE = { value: 0 }

const listeners = new Set<(t: number, moving: boolean) => void>()

/** Calls `fn` whenever the effect clock changes (for things that move on the CPU); returns the unsubscribe. */
export function onEffectTime(fn: (t: number, moving: boolean) => void): () => void {
  listeners.add(fn)
  fn(EFFECT_TIME.value, EFFECT_MOVE.value > 0)
  return () => void listeners.delete(fn)
}

export function setEffectTime(t: number, moving: boolean): void {
  EFFECT_TIME.value = t
  EFFECT_MOVE.value = moving ? 1 : 0
  for (const fn of listeners) fn(t, moving)
}
