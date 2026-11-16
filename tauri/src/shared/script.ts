// Text to timeline: "Alex walks to the cave, sees the Warden, panics, runs" becomes a list of steps made from the
// same presets as the palette. The result is ordinary blocks (nothing hidden), so it is only a first draft to adjust.
import type { ClipType } from './animation'
import type { CamType } from './camera'

export type Gait4 = 'sneak' | 'walk' | 'run' | 'sprint'

export type Step =
  | { kind: 'clip'; type: ClipType; subject: string | null; duration?: number; text: string; target?: string }
  | { kind: 'go'; subject: string | null; to: string | null; blocks?: number; gait: Gait4; text: string }
  | { kind: 'look'; subject: string | null; at: string; text: string }
  | { kind: 'camera'; type: CamType; subject: string | null; duration?: number; text: string }

export interface Parsed {
  steps: Step[]
  /** Parts of the text that said nothing it knows. */
  unknown: string[]
}

/** What the text can talk about: the characters (who does things) and other things in the scene (where to go). */
export interface Cast {
  characters: string[]
  places: string[]
}

const ACTIONS: [RegExp, ClipType][] = [
  [/\b(wav(e|es|ing)|greet(s|ing)?|say(s)? (hi|hello)|says? goodbye)\b/, 'wave'],
  [/\b(point(s|ing)?|gestures?)\b/, 'point'],
  [/\b(shak(e|es|ing) (his |her |their |its |the )?head|disagree[sd]?|refus(e|es|ed)|says? no)\b/, 'shake'],
  [/\b(nod(s|ding)?|agree[sd]?|says? yes)\b/, 'nod'],
  [/\b(shrug(s|ged|ging)?)\b/, 'shrug'],
  [/\b(laugh(s|ed|ing)?|giggl(e|es|ed)|chuckl(e|es|ed)|cracks? up)\b/, 'laugh'],
  [/\b(panic(s|ked|king)?|freak(s|ed)?( out)?|scream(s|ed)?|flail(s|ed)?|screams?)\b/, 'panic'],
  [/\b(cower(s|ed|ing)?|hid(e|es)|ducks?|tremble[sd]?|shiver(s|ed)?|cringe[sd]?)\b/, 'cower'],
  [/\b(facepalm(s|ed)?|face-palm(s|ed)?)\b/, 'facepalm'],
  [/\b(punch(es|ed|ing)?|jab(s|bed)?|fight(s|ing)?|box(es|ed)?)\b/, 'punch'],
  [
    /\b(slash(es|ed|ing)?|swing(s|ing)? (a |his |her |their |the )?(sword|blade|axe)|swung|attack(s|ed|ing)?|strikes?)\b/,
    'slash'
  ],
  [
    /\b(guard(s|ed|ing)?|defend(s|ed)?|shield(s|ed)?|parr(y|ies|ied)|block(s|ed|ing)? (it|him|her|them|the (attack|hit|blow|arrow)s?|an? (attack|hit|blow|arrow)))\b/,
    'block'
  ],
  [/\b(cheer(s|ed|ing)?|celebrat(e|es|ed|ing)|rejoice[sd]?|hooray|victory)\b/, 'cheer'],
  [/\b(clap(s|ped|ping)?|applaud(s|ed)?)\b/, 'clap'],
  [/\b(think(s|ing)?|ponder(s|ed)?|wonder(s|ed)?|consider(s|ed)?|hmm+)\b/, 'think'],
  [/\b(fall(s|ing)?|collaps(e|es|ed)|faint(s|ed)?|trip(s|ped)?|die[sd]?|knocked (out|down))\b/, 'fall'],
  [/\b(sleep(s|ing)?|slept|nap(s|ped)?|doz(e|es|ed)|lie(s)? down|lay down)\b/, 'sleep'],
  [/\b(bow(s|ed|ing)?|curtsy|curtsies)\b/, 'bow'],
  [/\b(sit(s|ting)?( down)?|sat( down)?|rest(s|ed)?|relax(es|ed)?)\b/, 'sit'],
  [/\b(mine[sd]?|mining|dig(s|ging)?|pickaxe[sd]?)\b/, 'mine'],
  [/\b(chop(s|ped|ping)?|fell(s|ed)? a tree)\b/, 'chop'],
  [/\b(eat(s|ing)?|drink(s|ing)?|munch(es|ed)?|sip(s|ped)?|gobbles?)\b/, 'eat'],
  [/\b(get(s|ting)? hit|is hit|takes? (a )?(hit|damage)|flinch(es|ed)?|ouch|gets? hurt|hurt)\b/, 'hit'],
  [/\b(reach(es|ed)? (for|out)|grab(s|bed)?|touch(es|ed)?|opens?|takes?|picks? up|presses|pushes)\b/, 'reach'],
  [/\b(jump(s|ed|ing)?|hop(s|ped)?|leap(s|ed)?|bounce[sd]?)\b/, 'jump'],
  [/\b(wait(s|ed|ing)?|stand(s|ing)?( there)?|look(s|ing)? around|idle[sd]?|pause[sd]?|stops?)\b/, 'idle'],
  [/\b(swim(s|ming)?|dive[sd]?|paddle[sd]?)\b/, 'swim'],
  [/\b(climb(s|ed|ing)?|scal(e|es|ed) )\b/, 'climb']
]

const TRAVEL: [RegExp, Gait4][] = [
  [/\b(sprint(s|ed|ing)?|bolt(s|ed)?|race[sd]?)\b/, 'sprint'],
  [/\b(run(s|ning)?|ran|dash(es|ed)?|rush(es|ed)?|flee(s)?|fled|hurr(y|ies|ied)|jog(s|ged)?)\b/, 'run'],
  [/\b(sneak(s|ed|ing)?|creep(s|ing)?|crept|tiptoe[sd]?|stalk(s|ed)?)\b/, 'sneak'],
  [
    /\b(walk(s|ed|ing)?|stroll(s|ed)?|wander(s|ed)?|head(s|ed|ing)?|go(es|ing)?|went|move[sd]?|approach(es|ed)?|march(es|ed)?|travel(s|led)?|come[sd]?|return(s|ed)?|follow(s|ed)?)\b/,
    'walk'
  ]
]

const CAMERAS: [RegExp, CamType][] = [
  [/\b(bullet[- ]time)\b/, 'bullet'],
  [/\b(orbit(s|ed|ing)?|circle[sd]?|spin(s)? around)\b/, 'orbit'],
  [/\b(push(es)? in|zoom(s|ed)? in|close[- ]?up|move(s)? in)\b/, 'push'],
  [/\b(crash zoom)\b/, 'zoom'],
  [/\b(pull(s)? (back|out)|zoom(s|ed)? out|wide shot|reveal)\b/, 'pull'],
  [/\b(whip[- ]pan|whip(s)?)\b/, 'whip'],
  [/\b(crane|rises?)\b/, 'crane'],
  [/\b(fly[- ]?through|drone)\b/, 'drone'],
  [/\b(over[- ]the[- ]shoulder)\b/, 'shoulder'],
  [/\b(low (hero )?(angle|shot)|hero shot)\b/, 'hero'],
  [/\b(dolly)\b/, 'dolly'],
  [/\b(hand ?held|shak(y|es) camera)\b/, 'handheld'],
  [/\b(follows?)\b/, 'follow'],
  [/\b(hold(s)?)\b/, 'hold']
]

const SEE =
  /\b(see(s|ing)?|saw|notice[sd]?|spot(s|ted)?|watch(es|ed)?|look(s|ed|ing)? (at|toward|towards)|stares? at|glances? at|eyes)\b/
const NUMBER_WORDS: Record<string, number> = {
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10
}

const clean = (s: string): string =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9\s'-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

/** Which of `names` the text mentions (longest name wins, "the" and case ignored). */
function mention(text: string, names: string[]): string | null {
  const t = ` ${clean(text)} `
  let best: string | null = null
  for (const n of names) {
    const c = clean(n).replace(/^the /, '')
    if (c.length < 2) continue
    if (t.includes(` ${c} `) || t.includes(` the ${c} `) || t.includes(` ${c}s `))
      if (!best || c.length > clean(best).length) best = n
  }
  return best
}

function seconds(text: string): number | undefined {
  const m = /\bfor (\d+(?:\.\d+)?|\w+) seconds?\b|\b(\d+(?:\.\d+)?|\w+) seconds?\b/.exec(text)
  const raw = m?.[1] ?? m?.[2]
  const v = raw === undefined ? NaN : Number.isNaN(Number(raw)) ? (NUMBER_WORDS[raw] ?? NaN) : Number(raw)
  return Number.isFinite(v) && v > 0 && v <= 60 ? v : undefined
}

function blocksOf(text: string): number | undefined {
  const m = /\b(\d+|\w+) blocks?\b/.exec(text)
  const raw = m?.[1]
  const v = raw === undefined ? NaN : Number.isNaN(Number(raw)) ? (NUMBER_WORDS[raw] ?? NaN) : Number(raw)
  return Number.isFinite(v) && v > 0 && v <= 200 ? v : undefined
}

/** Cuts text into the things done one after another. */
export function segments(text: string): string[] {
  return text
    .split(
      /[.;\n]+|,|\band then\b|\bthen\b|\bafter that\b|\bnext\b|\bfinally\b|\bbefore\b|->|→|\band\b(?=\s+(?:[a-z']+(?:s|es|ed)?\b))/i
    )
    .map((s) => s.trim())
    .filter(Boolean)
}

/** The steps a piece of text describes, with who does them and where they go. */
export function parseScript(text: string, cast: Cast): Parsed {
  const steps: Step[] = []
  const unknown: string[] = []
  let subject: string | null = cast.characters.length === 1 ? cast.characters[0] : null
  for (const raw of segments(text)) {
    const c = clean(raw)
    if (!c) continue
    const who = mention(c, cast.characters)
    // "Alex walks…": whoever is named first leads, and carries on in the segments after.
    const leads = who && c.indexOf(clean(who).replace(/^the /, '')) <= 2
    if (leads) subject = who
    const doer = leads ? who : subject
    const dur = seconds(c)

    const camera = /\b(camera|shot|zoom|zooms|orbit|orbits|pan|crane|drone|dolly|close[- ]?up|handheld|bullet)/.test(c)
      ? CAMERAS.find(([re]) => re.test(c))
      : undefined
    if (camera) {
      steps.push({ kind: 'camera', type: camera[1], subject: doer, duration: dur, text: raw })
      continue
    }

    const see = SEE.test(c)
      ? mention(c.replace(clean(doer ?? ''), ''), [...cast.places, ...cast.characters.filter((n) => n !== doer)])
      : null
    if (see) {
      steps.push({ kind: 'look', subject: doer, at: see, text: raw })
      continue
    }

    // Where to: "to the cave", "toward Alex", "10 blocks".
    const place = mention(c.replace(clean(doer ?? ''), ''), [
      ...cast.places,
      ...cast.characters.filter((n) => n !== doer)
    ])
    const travel = TRAVEL.find(([re]) => re.test(c))
    const action = ACTIONS.find(([re]) => re.test(c))
    // "walks to the chest and opens it" is two things; here one segment is one thing, travel winning only with a place.
    if (
      travel &&
      (!action || (place && /\b(to|toward|towards|into|up to|over to|across to)\b/.test(c)) || action[1] === 'idle')
    ) {
      steps.push({ kind: 'go', subject: doer, to: place, blocks: blocksOf(c), gait: travel[1], text: raw })
      continue
    }
    if (action) {
      steps.push({
        kind: 'clip',
        type: action[1],
        subject: doer,
        duration: dur,
        text: raw,
        ...(action[1] === 'reach' && place ? { target: place } : {})
      })
      continue
    }
    if (travel) {
      steps.push({ kind: 'go', subject: doer, to: place, blocks: blocksOf(c), gait: travel[1], text: raw })
      continue
    }
    unknown.push(raw)
  }
  return { steps, unknown }
}
