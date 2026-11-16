// Sound for the timeline: what it looks like (a waveform), how loud it is moment to moment (for a talking head to
// follow), and where its beats are (for blocks to snap to). Works on decoded samples; no audio device involved.

/** One channel from several: their average. */
export function monoOf(channels: Float32Array[]): Float32Array {
  if (channels.length === 1) return channels[0]
  const out = new Float32Array(channels[0].length)
  for (const c of channels) for (let i = 0; i < out.length; i++) out[i] += c[i] / channels.length
  return out
}

const round2 = (v: number): number => Math.round(v * 100) / 100

/** The loudest sample in each of `buckets` equal slices (0…1), to draw as a waveform. */
export function waveformPeaks(mono: Float32Array, buckets: number): number[] {
  const n = Math.max(1, Math.min(buckets, mono.length))
  const out: number[] = []
  for (let b = 0; b < n; b++) {
    const lo = Math.floor((b * mono.length) / n)
    const hi = Math.max(lo + 1, Math.floor(((b + 1) * mono.length) / n))
    let peak = 0
    for (let i = lo; i < hi; i++) peak = Math.max(peak, Math.abs(mono[i]))
    out.push(round2(Math.min(1, peak)))
  }
  return out
}

/** Frames of loudness per second in `loudness`. */
export const LEVEL_RATE = 30

/**
 * How loud it is, `LEVEL_RATE` times a second: the RMS of each slice, quick to rise and slower to fall like a mouth
 * opening and closing, scaled so the loud parts reach 1.
 */
export function loudness(mono: Float32Array, sampleRate: number): number[] {
  const hop = Math.max(1, Math.floor(sampleRate / LEVEL_RATE))
  const raw: number[] = []
  for (let i = 0; i < mono.length; i += hop) {
    let sum = 0
    const end = Math.min(mono.length, i + hop)
    for (let j = i; j < end; j++) sum += mono[j] * mono[j]
    raw.push(Math.sqrt(sum / Math.max(1, end - i)))
  }
  if (!raw.length) return []
  const sorted = [...raw].sort((a, b) => a - b)
  const top = sorted[Math.floor(sorted.length * 0.95)] || sorted[sorted.length - 1] || 1
  let level = 0
  return raw.map((v) => {
    const x = Math.min(1, v / (top || 1))
    level = x > level ? level + (x - level) * 0.7 : level + (x - level) * 0.3
    return round2(level)
  })
}

/** The loudness at time `t` (seconds), between the two nearest frames; 0 outside the sound. */
export function levelAt(env: number[], t: number): number {
  if (!env.length || t < 0) return 0
  const f = t * LEVEL_RATE
  const i = Math.floor(f)
  if (i >= env.length) return 0
  return env[i] + (env[Math.min(env.length - 1, i + 1)] - env[i]) * (f - i)
}

export interface Beats {
  /** Beats a minute, or null when there is no steady beat to find. */
  bpm: number | null
  /** Seconds from the start of the sound. */
  beats: number[]
}

const ONSET_RATE = 100

/**
 * Finds a steady beat: where the sound suddenly gets louder (onsets), how often that repeats (the tempo, 60 to 180
 * a minute) and where on the clock the repeats fall.
 */
export function findBeats(mono: Float32Array, sampleRate: number): Beats {
  const hop = Math.max(1, Math.floor(sampleRate / ONSET_RATE))
  const n = Math.floor(mono.length / hop)
  if (n < ONSET_RATE * 3) return { bpm: null, beats: [] }
  // Energy per slice, then how much it jumped from the one before (in log, so quiet beats count as much).
  const energy = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    let s = 0
    for (let j = i * hop; j < (i + 1) * hop; j++) s += mono[j] * mono[j]
    energy[i] = s / hop
  }
  const onset = new Float32Array(n)
  let peak = 0
  for (let i = 1; i < n; i++) {
    onset[i] = Math.max(0, Math.log(energy[i] + 1e-9) - Math.log(energy[i - 1] + 1e-9))
    peak = Math.max(peak, onset[i])
  }
  if (peak < 1) return { bpm: null, beats: [] }
  // Only the clear jumps (a fraction of the biggest ones), so that the hiss between beats doesn't matter.
  for (let i = 0; i < n; i++) onset[i] = onset[i] > peak * 0.25 ? onset[i] : 0

  const minLag = Math.round((60 / 180) * ONSET_RATE)
  const maxLag = Math.round((60 / 60) * ONSET_RATE)
  const auto = new Float64Array(maxLag + 2)
  for (let lag = minLag - 1; lag <= maxLag + 1; lag++) {
    let sum = 0
    for (let i = lag; i < n; i++) sum += onset[i] * onset[i - lag]
    // A little weight toward the common tempos, so a beat is not mistaken for its half or double.
    const bpm = (60 * ONSET_RATE) / lag
    auto[lag] = sum * (1 + 0.15 * Math.exp(-Math.pow(Math.log2(bpm / 120), 2)))
  }
  let best = minLag
  for (let lag = minLag; lag <= maxLag; lag++) if (auto[lag] > auto[best]) best = lag
  if (auto[best] <= 0) return { bpm: null, beats: [] }
  // A fraction of a slice more exact, from the neighbours of the best lag.
  const a = auto[best - 1]
  const b = auto[best]
  const c = auto[best + 1]
  const denom = a - 2 * b + c
  const lag = best + (denom < 0 ? (0.5 * (a - c)) / denom : 0)

  // Where the grid falls: the offset that puts most onsets on its lines (a little either side counts).
  let phase = 0
  let phaseScore = -1
  for (let p = 0; p < Math.ceil(lag); p++) {
    let score = 0
    for (let k = 0; p + k * lag < n; k++) {
      const i = Math.round(p + k * lag)
      score += onset[i] + 0.5 * ((onset[i - 1] ?? 0) + (onset[i + 1] ?? 0))
    }
    if (score > phaseScore) {
      phaseScore = score
      phase = p
    }
  }
  const beats: number[] = []
  for (let k = 0; phase + k * lag < n; k++) beats.push(Math.round(((phase + k * lag) / ONSET_RATE) * 1000) / 1000)
  return { bpm: Math.round(((60 * ONSET_RATE) / lag) * 10) / 10, beats }
}

/** `t` moved to the nearest of the beats if one is within `within` seconds. */
export function snapToBeats(t: number, beats: number[], within = 0.12): number {
  if (!beats.length) return t
  let lo = 0
  let hi = beats.length - 1
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (beats[mid] < t) lo = mid + 1
    else hi = mid
  }
  const near = [beats[lo - 1], beats[lo]].filter((b) => b !== undefined)
  const best = near.reduce((m, b) => (Math.abs(b - t) < Math.abs(m - t) ? b : m), near[0])
  return Math.abs(best - t) <= within ? best : t
}
