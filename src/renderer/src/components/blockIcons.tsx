// The icon for each kind of block, shared by the Animate panel and the quick actions in the scene.
import type { ReactNode } from 'react'
import {
  Activity,
  Annoyed,
  ArrowBigDown,
  ArrowUpFromLine,
  Armchair,
  Axe,
  Bed,
  Brain,
  ChevronsDown,
  Dumbbell,
  Eye,
  Footprints,
  Frown,
  Hammer,
  Hand,
  Laugh,
  Meh,
  Mountain,
  MoveRight,
  MoveUp,
  PartyPopper,
  PersonStanding,
  Pickaxe,
  Pointer,
  RotateCw,
  Shield,
  ShieldHalf,
  Siren,
  Sparkles,
  Swords,
  Target,
  ThumbsUp,
  User,
  Utensils,
  Waves,
  Wind,
  Zap,
  type LucideIcon
} from 'lucide-react'
import type { ClipType } from '@shared/animation'

const BLOCK_ICONS: Record<ClipType, LucideIcon> = {
  walk: Footprints,
  run: Wind,
  sprint: Zap,
  sneak: Eye,
  swim: Waves,
  climb: Mountain,
  leap: ArrowUpFromLine,
  idle: User,
  jump: MoveUp,
  point: Pointer,
  wave: Hand,
  shrug: Meh,
  nod: ThumbsUp,
  shake: Annoyed,
  laugh: Laugh,
  panic: Siren,
  cower: ShieldHalf,
  facepalm: Frown,
  bow: ChevronsDown,
  sit: Armchair,
  mine: Pickaxe,
  chop: Axe,
  eat: Utensils,
  reach: Target,
  hit: Hammer,
  punch: Dumbbell,
  slash: Swords,
  block: Shield,
  cheer: PartyPopper,
  clap: Sparkles,
  think: Brain,
  fall: ArrowBigDown,
  sleep: Bed,
  pose: PersonStanding,
  lunge: MoveRight,
  spin: RotateCw
}

export function BlockIcon({ type, size = 15 }: { type: ClipType; size?: number }): ReactNode {
  const Icon = BLOCK_ICONS[type] ?? Activity
  return <Icon size={size} />
}

/** The actions (blocks that don't travel), grouped the way the Animate panel lists them. */
export const ACTION_GROUPS: [string, ClipType[]][] = [
  [
    'Everyday',
    ['pose', 'idle', 'wave', 'point', 'nod', 'shake', 'bow', 'think', 'sit', 'sleep', 'eat', 'reach', 'jump']
  ],
  ['Feelings', ['laugh', 'cheer', 'clap', 'shrug', 'facepalm', 'panic', 'cower']],
  ['Fight', ['punch', 'slash', 'block', 'lunge', 'hit', 'spin', 'fall']],
  ['Work', ['mine', 'chop']]
]
