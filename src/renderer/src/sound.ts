// The animation's sound: bringing a file in (and finding its beats), playing it along with the timeline, and
// mixing it for a video's soundtrack.
import { findBeats, loudness, monoOf, waveformPeaks } from '@shared/audio'
import type { AudioTrack } from '@shared/animation'
import { animationOf, setAnimation, soundHooks, useAnim } from './animation'
import { mediaStore, registerMedia } from './media'

const MIME: Record<string, string> = {
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  ogg: 'audio/ogg',
  m4a: 'audio/mp4',
  aac: 'audio/aac',
  flac: 'audio/flac',
  webm: 'audio/webm'
}

let context: AudioContext | null = null
const audioContext = (): AudioContext => (context ??= new AudioContext())
const decoded = new Map<string, Promise<AudioBuffer | null>>()

/** The sound as samples, decoded the first time it is needed. */
export function bufferOf(mediaId: string): Promise<AudioBuffer | null> {
  let p = decoded.get(mediaId)
  if (!p) {
    const m = mediaStore.get(mediaId)
    p = m
      ? audioContext()
          .decodeAudioData(m.bytes.slice().buffer as ArrayBuffer)
          .catch(() => null)
      : Promise.resolve(null)
    decoded.set(mediaId, p)
  }
  return p
}

/** Brings a sound file in: its waveform, loudness and beats are worked out and kept with the animation. */
export async function importSound(): Promise<string | null> {
  const file = await window.blockframe.openDataFile('audio')
  return file ? addSound(file.name, file.bytes) : null
}

/** Puts a sound (a file's name and bytes) under the animation. */
export async function addSound(name: string, bytes: Uint8Array): Promise<string> {
  const file = { name, bytes }
  const buffer = await audioContext()
    .decodeAudioData(file.bytes.slice().buffer as ArrayBuffer)
    .catch(() => null)
  if (!buffer) throw new Error("That sound file couldn't be read.")
  const mono = monoOf(Array.from({ length: buffer.numberOfChannels }, (_, i) => buffer.getChannelData(i)))
  const { bpm, beats } = findBeats(mono, buffer.sampleRate)
  const ext = file.name.split('.').pop()?.toLowerCase() ?? ''
  const entry = registerMedia(file.name, MIME[ext] ?? 'audio/mpeg', file.bytes)
  decoded.set(entry.id, Promise.resolve(buffer))
  const audio: AudioTrack = {
    mediaId: entry.id,
    name: file.name,
    offset: 0,
    volume: 1,
    length: Math.round(buffer.duration * 1000) / 1000,
    peaks: waveformPeaks(mono, Math.min(4000, Math.max(50, Math.ceil(buffer.duration * 8)))),
    env: loudness(mono, buffer.sampleRate),
    bpm,
    beats,
    snap: false
  }
  stopSound()
  setAnimation({ audio })
  return bpm
    ? `Added ${file.name}: about ${Math.round(bpm)} beats a minute.`
    : `Added ${file.name}: no steady beat found.`
}

export function removeSound(): void {
  stopSound()
  setAnimation({ audio: null })
}

/** Changes how the sound sits (where it starts, how loud, whether blocks snap to its beats). */
export function setSound(patch: Partial<Pick<AudioTrack, 'offset' | 'volume' | 'snap'>>): void {
  const a = animationOf().audio
  if (!a) return
  setAnimation({ audio: { ...a, ...patch } })
}

// ------------------------------------------------------------------ playing

let source: AudioBufferSourceNode | null = null
let gain: GainNode | null = null

export function stopSound(): void {
  try {
    source?.stop()
  } catch {
    /* already stopped */
  }
  source?.disconnect()
  source = null
}

/** Plays the sound from where the animation is at `time`. */
export function startSound(time: number): void {
  stopSound()
  const a = animationOf().audio
  if (!a) return
  void bufferOf(a.mediaId).then((buffer) => {
    const now = useAnim.getState()
    if (!buffer || !now.playing || source) return
    const ctx = audioContext()
    void ctx.resume()
    const at = time - a.offset
    if (at >= buffer.duration) return
    gain ??= ctx.createGain()
    gain.gain.value = animationOf().audio?.volume ?? 1
    gain.connect(ctx.destination)
    const node = ctx.createBufferSource()
    node.buffer = buffer
    node.connect(gain)
    // Before the sound starts it waits; after it has started it picks up part of the way in.
    if (at >= 0) node.start(0, at)
    else node.start(ctx.currentTime - at)
    node.onended = () => {
      if (source === node) source = null
    }
    source = node
  })
}

soundHooks.start = startSound
soundHooks.stop = stopSound

/** Keeps the volume slider live while playing. */
useAnim.subscribe(() => {
  const v = animationOf().audio?.volume
  if (gain && v !== undefined) gain.gain.value = v
})

/** The sound as it falls in an animation `length` seconds long, mixed down to a stereo buffer for a video. */
export async function soundMix(length: number): Promise<AudioBuffer | null> {
  const a = animationOf().audio
  const buffer = a && (await bufferOf(a.mediaId))
  if (!a || !buffer) return null
  const rate = 48000
  const offline = new OfflineAudioContext(2, Math.max(1, Math.ceil(length * rate)), rate)
  const node = offline.createBufferSource()
  node.buffer = buffer
  const g = offline.createGain()
  g.gain.value = a.volume
  node.connect(g).connect(offline.destination)
  if (a.offset >= 0) node.start(a.offset)
  else node.start(0, -a.offset)
  return offline.startRendering()
}
