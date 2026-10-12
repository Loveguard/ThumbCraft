import type { ReactNode } from 'react'
import { Shuffle } from 'lucide-react'
import { useStore, type LightningObject } from '../store'
import { Hint } from './controls'

export function LightningProperties({ o }: { o: LightningObject }): ReactNode {
  const set = (patch: Partial<LightningObject>): void => useStore.getState().update(o.id, patch)
  return (
    <>
      <button
        title="Another bolt shape (vanilla picks one at random per strike)"
        onClick={() => set({ seed: Math.floor(Math.random() * 2 ** 31) })}
      >
        <Shuffle size={15} /> New bolt shape
      </button>
      <label className="field slider">
        <span>Brightness</span>
        <input
          type="range"
          min={0.5}
          max={4}
          step={0.05}
          value={o.brightness}
          onChange={(e) => set({ brightness: Number(e.target.value) })}
        />
        <em>{o.brightness.toFixed(2)}</em>
      </label>
      <label className="field slider">
        <span>Thickness</span>
        <input
          type="range"
          min={0.15}
          max={1}
          step={0.05}
          value={o.thickness ?? 1}
          onChange={(e) => set({ thickness: Number(e.target.value) })}
        />
        <em>{Math.round((o.thickness ?? 1) * 100)}%</em>
      </label>
      <label className="field">
        <span>Colour</span>
        <input type="color" value={o.color} onChange={(e) => set({ color: e.target.value })} />
        <button className="sm" title="Vanilla's colour" onClick={() => set({ color: '#737380' })}>
          Vanilla
        </button>
      </label>
      <label className="check">
        <input type="checkbox" checked={o.flash} onChange={(e) => set({ flash: e.target.checked })} />
        <span>Flash lights up the ground</span>
      </label>
      <Hint>Turn on Bloom in the Sky tab for a glowing bolt. It shows best against a dark or stormy sky.</Hint>
    </>
  )
}
