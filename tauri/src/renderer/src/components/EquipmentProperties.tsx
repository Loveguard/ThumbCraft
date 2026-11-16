import { useMemo, useState, type ReactNode } from 'react'
import { X } from 'lucide-react'
import { itemIcon, listItems } from '@shared/minecraft/items'
import { ARMOR_SLOTS, type ArmorSlot } from '@shared/minecraft/playerModel'
import { assetUrl } from '../minecraft/assets'
import { armorMaterials, SHIELD_TEXTURE } from '../minecraft/equipment'
import { NO_EQUIPMENT, useStore, type Equipment, type PlayerObject } from '../store'
import { Group } from './controls'
import { OUTFITS } from '../minecraft/outfits'

const SLOT_LABEL: Record<ArmorSlot, string> = { head: 'Helmet', chest: 'Chestplate', legs: 'Leggings', feet: 'Boots' }
/** Shown first in the item picker: what thumbnails use most. */
const FAVOURITES = [
  'diamond_sword',
  'netherite_sword',
  'diamond_pickaxe',
  'bow',
  'golden_apple',
  'totem_of_undying',
  'ender_pearl',
  'tnt',
  'torch',
  'diamond',
  'emerald',
  'water_bucket'
]

const pretty = (id: string): string => id.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase())

/** Whether this version has the shield (drawn from its entity texture; it has no ordinary item model). */
const useHasShield = (): boolean => useStore((s) => !!s.assets?.textures.includes(SHIELD_TEXTURE))

function ItemPicker({ onPick }: { onPick: (id: string) => void }): ReactNode {
  const models = useStore((s) => s.assets?.models)
  const hasShield = useHasShield()
  const [q, setQ] = useState('')
  const items = useMemo(
    () => (models ? [...listItems(models), ...(hasShield ? ['shield'] : [])].sort() : []),
    [models, hasShield]
  )
  const shown = useMemo(() => {
    if (!q) return [...FAVOURITES.filter((f) => items.includes(f)), ...items.filter((i) => !FAVOURITES.includes(i))]
    const words = q.toLowerCase().split(/\s+/).filter(Boolean)
    return items.filter((i) => words.every((w) => i.includes(w)))
  }, [items, q])
  return (
    <div className="item-picker">
      <input autoFocus placeholder={`Search ${items.length} items…`} value={q} onChange={(e) => setQ(e.target.value)} />
      <div className="item-grid">
        {shown.slice(0, 120).map((id) => {
          const icon = models ? itemIcon(models, id) : null
          return (
            <button key={id} title={pretty(id)} onClick={() => onPick(id)}>
              {icon ? <img src={assetUrl(icon)} alt="" /> : <span className="item-noicon" />}
            </button>
          )
        })}
      </div>
    </div>
  )
}

function HandSlot({
  label,
  value,
  onChange
}: {
  label: string
  value: string | null
  onChange: (id: string | null) => void
}): ReactNode {
  const models = useStore((s) => s.assets?.models)
  const [open, setOpen] = useState(false)
  const icon = value && models ? itemIcon(models, value) : null
  return (
    <>
      <div className="field">
        <span>{label}</span>
        <div className="hand-slot">
          <button className="hand-pick" onClick={() => setOpen((v) => !v)}>
            {icon && <img src={assetUrl(icon)} alt="" />}
            <span>{value ? pretty(value) : 'Empty'}</span>
          </button>
          {value && (
            <button className="icon-btn sm" title="Empty this hand" onClick={() => onChange(null)}>
              <X size={13} />
            </button>
          )}
        </div>
      </div>
      {open && (
        <ItemPicker
          onPick={(id) => {
            onChange(id)
            setOpen(false)
          }}
        />
      )}
    </>
  )
}

export function EquipmentProperties({ o }: { o: PlayerObject }): ReactNode {
  const textures = useStore((s) => s.assets?.textures)
  const materials = useMemo(() => (textures ? armorMaterials(textures) : []), [textures])
  const eq = o.equipment ?? NO_EQUIPMENT
  const set = (patch: Partial<Equipment>): void => useStore.getState().update(o.id, { equipment: { ...eq, ...patch } })
  const fullSets = materials.filter((m) => ARMOR_SLOTS.every((s) => m.slots.includes(s)))
  const wearsLeather = ARMOR_SLOTS.some((s) => eq[s] === 'leather')
  const hasShield = useHasShield()

  return (
    <>
      <h4>Armour</h4>
      <div className="chips">
        {fullSets.map((m) => (
          <button
            key={m.id}
            className={`chip ${ARMOR_SLOTS.every((s) => eq[s] === m.id) ? 'active' : ''}`}
            onClick={() => set({ head: m.id, chest: m.id, legs: m.id, feet: m.id })}
          >
            {m.label}
          </button>
        ))}
        <button className="chip" onClick={() => set({ head: null, chest: null, legs: null, feet: null })}>
          None
        </button>
      </div>
      <Group id="armor-pieces" title="Mix armour pieces">
        {ARMOR_SLOTS.map((slot) => (
          <label key={slot} className="field">
            <span>{SLOT_LABEL[slot]}</span>
            <select value={eq[slot] ?? ''} onChange={(e) => set({ [slot]: e.target.value || null })}>
              <option value="">None</option>
              {materials
                .filter((m) => m.slots.includes(slot))
                .map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.label}
                  </option>
                ))}
            </select>
          </label>
        ))}
        {wearsLeather && (
          <label className="field">
            <span>Leather dye</span>
            <input type="color" value={eq.leatherColor} onChange={(e) => set({ leatherColor: e.target.value })} />
          </label>
        )}
      </Group>

      <h4>Outfit</h4>
      <div className="chips">
        <button className={`chip ${!eq.outfit ? 'active' : ''}`} onClick={() => set({ outfit: null })}>
          None
        </button>
        {OUTFITS.map((f) => (
          <button
            key={f.id}
            title={f.hint}
            className={`chip ${eq.outfit === f.id ? 'active' : ''}`}
            onClick={() => set({ outfit: f.id })}
          >
            {f.label}
          </button>
        ))}
      </div>
      {eq.outfit && <p className="hint">Outfits are worn instead of armour.</p>}

      <h4>Held items</h4>
      <HandSlot label="Main hand" value={eq.mainHand} onChange={(mainHand) => set({ mainHand })} />
      <HandSlot label="Off hand" value={eq.offHand} onChange={(offHand) => set({ offHand })} />
      {hasShield && eq.offHand !== 'shield' && (
        <button className="link" onClick={() => set({ offHand: 'shield' })}>
          Give a shield (off hand)
        </button>
      )}
    </>
  )
}
