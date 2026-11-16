// The Animation mode's side panel: pick a character, add blocks to its row of the timeline (drag them there or click),
// and change the selected block. Characters without blocks can still be keyed by hand.
import { useState, type ReactNode } from 'react'
import {
  Activity,
  Annoyed,
  ArrowBigDown,
  ArrowUpFromLine,
  Armchair,
  Axe,
  Bed,
  Box,
  Brain,
  ChevronsDown,
  Dumbbell,
  Footprints,
  Frown,
  Hammer,
  Hand,
  Laugh,
  Meh,
  Mountain,
  MoveUp,
  PartyPopper,
  Pickaxe,
  Play,
  Pointer,
  Shield,
  ShieldHalf,
  Siren,
  Sparkles,
  Swords,
  Target,
  ThumbsUp,
  Utensils,
  Waves,
  Wind,
  Zap,
  type LucideIcon,
  Crosshair,
  Download,
  DiamondMinus,
  DiamondPlus,
  Eye,
  Layers,
  MapPin,
  MousePointerClick,
  Music,
  Navigation,
  Route,
  Trash2,
  Undo2,
  Upload,
  User,
  Video,
  Wand2
} from 'lucide-react'
import { useShallow } from 'zustand/react/shallow'
import { CAM_ORDER, CAMS } from '@shared/camera'
import {
  canLayer,
  CLIP_ORDER,
  CLIPS,
  GAITS,
  isMoving,
  keyAt,
  laneOf,
  MIN_CLIP,
  modeOf,
  NO_ANIMATION,
  type ClipMode,
  type ClipType
} from '@shared/animation'
import {
  addCamClip,
  addClip,
  bakeClips,
  camClipOf,
  canAnimate,
  canDo,
  suggestionsFor,
  canWalk,
  clearTrack,
  draftFromText,
  clipOf,
  deleteClip,
  deleteKey,
  removePathPoint,
  resetPath,
  setAnimation,
  followPrevious,
  setCamClip,
  setClipAuto,
  setClipDuration,
  setBreathe,
  setClipLayer,
  setClipMode,
  setClipReach,
  setLook,
  setTalk,
  setClipType,
  setKey,
  useAnim
} from '../animation'
import { useLayout } from '../layout'
import { useStore } from '../store'
import { Group, Hint, Slider, Toggle } from './controls'
import { exportBlockbench, exportGlb, importBlockbench } from '../interchange'
import { importSound, removeSound, setSound } from '../sound'
import { PresetsSection } from './PresetsSection'
import { CurvesPanel } from './CurvesPanel'
import { ScenePanel } from './ScenePanel'

const PANEL_TABS = [
  { id: 'add', label: 'Add a block' },
  { id: 'start', label: 'Start from' },
  { id: 'tune', label: 'Fine-tune' }
] as const
const BLOCK_KINDS = ['Move', 'Act', 'Camera'] as const

const MOVING: ClipType[] = ['walk', 'run', 'sprint', 'sneak']
const MODE_LABEL: Record<ClipMode, string> = { loop: 'Loop', once: 'Once', hold: 'Hold' }

export function AnimatePanel(): ReactNode {
  const [script, setScript] = useState('')
  const [view, setView] = useState<'add' | 'start' | 'tune'>('add')
  const [kind, setKind] = useState<(typeof BLOCK_KINDS)[number]>('Move')
  const [shareNote, setShareNote] = useState<string | null>(null)
  const run = (fn: () => Promise<string | null>): void => {
    setShareNote(null)
    fn()
      .then((m) => m && setShareNote(m))
      .catch((e: Error) => setShareNote(e.message))
  }
  const objects = useStore((s) => s.objects)
  const selectedId = useStore((s) => s.selectedId)
  const animation = useStore((s) => s.settings.animation) ?? NO_ANIMATION
  const { time, sel, selectedPoint, addingPoints, pickingTarget, goingTo, travel, gaits, trails, onion } = useAnim(
    useShallow((a) => ({
      gaits: a.gaits,
      time: a.time,
      sel: a.selectedClip,
      selectedPoint: a.selectedPoint,
      addingPoints: a.addingPoints,
      pickingTarget: a.pickingTarget,
      goingTo: a.goingTo,
      travel: a.travel,
      trails: a.trails,
      onion: a.onion
    }))
  )
  const select = useStore((s) => s.select)
  const openTab = useLayout((s) => s.openAssetTab)
  const o = objects.find((x) => x.id === selectedId)
  const track = animation.tracks.find((t) => t.objectId === selectedId)
  const characters = objects.filter(canWalk)
  const keyHere = track ? keyAt(track.keys, time) : -1
  const clip = clipOf(sel)
  const cam = camClipOf(sel)
  const clipObject = clip && objects.find((x) => x.id === sel?.objectId)
  const byBlocks = !!track?.clips?.length

  return (
    <div className="tab-body animate-panel">
      <h4>Characters</h4>
      {characters.length ? (
        <div className="anim-characters">
          {characters.map((c) => {
            const animated = animation.tracks.some((t) => t.objectId === c.id)
            const Icon = c.kind === 'player' ? User : Box
            return (
              <button
                key={c.id}
                className={`anim-character ${c.id === selectedId ? 'active' : ''}`}
                onClick={() => select(c.id)}
              >
                <Icon size={14} />
                <span>{c.name}</span>
                {animated && <em title="Has an animation">animated</em>}
              </button>
            )
          })}
        </div>
      ) : (
        <>
          <p className="muted">No characters yet. Add a player or a mob, then come back here to animate it.</p>
          <div className="row">
            <button className="ghost" onClick={() => openTab('players')}>
              <User size={14} /> Add a player
            </button>
            <button className="ghost" onClick={() => openTab('mobs')}>
              <Box size={14} /> Add a mob
            </button>
          </div>
        </>
      )}

      {(cam || (clip && clipObject)) && (
        <section className="block-inspector" aria-label="Selected block">
          {cam && sel && (
            <>
              <div className="insp-head">
                <Video size={16} />
                <strong>{CAMS[cam.type].label}</strong>
                <span>Camera block</span>
              </div>
              <Slider
                label="Length"
                min={MIN_CLIP}
                max={20}
                step={0.1}
                value={cam.duration}
                onChange={(v) => setClipDuration(sel.objectId, cam.id, v)}
                format={(v) => `${v.toFixed(1)} s`}
              />
              {!['hold', 'follow'].includes(cam.type) ? (
                <Slider
                  label={cam.type === 'handheld' ? 'Shake' : 'Amount'}
                  min={0.25}
                  max={2.5}
                  step={0.05}
                  value={cam.amount ?? 1}
                  onChange={(v) => setCamClip(cam.id, { amount: v })}
                  format={(v) => `${Math.round(v * 100)}%`}
                />
              ) : null}
              <label className="field">
                <span>Frames</span>
                <select
                  value={cam.subject ?? ''}
                  onChange={(e) => setCamClip(cam.id, { subject: e.target.value || null })}
                >
                  <option value="">Where it started</option>
                  {characters.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </label>
              <Hint>
                {cam.view
                  ? 'This block starts from a view you set.'
                  : 'This block starts where the one before it ended.'}{' '}
                With it selected, just move around the viewport and it starts from wherever you let go.
              </Hint>
              {cam.view ? (
                <div className="row">
                  <button className="ghost" onClick={() => followPrevious(cam.id)}>
                    Follow the previous block
                  </button>
                </div>
              ) : null}
              <button className="ghost danger" onClick={() => deleteClip(sel.objectId, cam.id)}>
                <Trash2 size={14} /> Delete block
              </button>
            </>
          )}

          {clip && sel && clipObject && (
            <>
              <div className="insp-head">
                <BlockIcon type={clip.type} size={16} />
                <strong>{CLIPS[clip.type].label}</strong>
                <span>{clipObject.name}</span>
              </div>
              <Slider
                label="Length"
                min={MIN_CLIP}
                max={12}
                step={0.1}
                value={clip.duration}
                onChange={(v) => setClipDuration(sel.objectId, clip.id, v)}
                format={(v) => `${v.toFixed(1)} s`}
              />
              {isMoving(clip) && MOVING.includes(clip.type) && (
                <div className="segmented">
                  {MOVING.map((t) => (
                    <button
                      key={t}
                      className={clip.type === t ? 'active' : ''}
                      onClick={() => setClipType(sel.objectId, clip.id, t)}
                    >
                      {CLIPS[t].label}
                    </button>
                  ))}
                </div>
              )}
              {clip.type === 'walk' && (
                <>
                  <Toggle
                    label="Run when it has to be fast"
                    checked={clip.auto !== false}
                    onChange={(auto) => setClipAuto(sel.objectId, clip.id, auto)}
                  />
                  {gaits[clip.id] && gaits[clip.id] !== 'walk' && clip.auto !== false && (
                    <Hint>
                      This length is too quick for a walk, so it {GAITS[gaits[clip.id]].label.toLowerCase()}s.
                    </Hint>
                  )}
                </>
              )}
              {CLIPS[clip.type].modes.length > 1 && (
                <div className="segmented">
                  {CLIPS[clip.type].modes.map((m) => (
                    <button
                      key={m}
                      className={modeOf(clip) === m ? 'active' : ''}
                      title={
                        m === 'loop'
                          ? 'Repeats to fill the block'
                          : m === 'once'
                            ? 'Plays once through, stretched to the block'
                            : 'Goes to the pose and holds it'
                      }
                      onClick={() => setClipMode(sel.objectId, clip.id, m)}
                    >
                      {MODE_LABEL[m]}
                    </button>
                  ))}
                </div>
              )}
              {isMoving(clip) && (
                <>
                  <div className="row">
                    <button
                      className={addingPoints ? 'primary' : 'ghost'}
                      onClick={() => useAnim.setState({ addingPoints: !addingPoints })}
                      title="Click the ground to add points to the path (Enter or Esc to stop)"
                    >
                      <MapPin size={14} /> {addingPoints ? 'Done adding' : 'Add points'}
                    </button>
                    <button
                      className="ghost"
                      disabled={selectedPoint === null || (clip.path?.length ?? 0) < 2}
                      onClick={() => selectedPoint !== null && removePathPoint(selectedPoint)}
                    >
                      <Undo2 size={14} /> Remove point
                    </button>
                    <button className="ghost" onClick={() => resetPath(sel.objectId, clip.id)}>
                      <Route size={14} /> Straight ahead
                    </button>
                  </div>
                  <Hint>
                    The path starts where the block before it ends. Drag the yellow points in the scene to bend it.
                    {addingPoints ? ' Click the ground to add a point.' : ''}
                  </Hint>
                </>
              )}
              {clipObject.kind === 'player' && canLayer(clip.type) && (
                <>
                  <div className="segmented">
                    <button
                      className={laneOf(clip) === 'base' ? 'active' : ''}
                      title="On the body row it stands where the block before it ended"
                      onClick={() => setClipLayer(sel.objectId, clip.id, undefined)}
                    >
                      Whole body
                    </button>
                    <button
                      className={laneOf(clip) === 'upper' ? 'active' : ''}
                      title="On the upper body row it plays over the walk, run or jump under it"
                      onClick={() => setClipLayer(sel.objectId, clip.id, 'upper')}
                    >
                      Upper body
                    </button>
                  </div>
                  {laneOf(clip) === 'upper' && (
                    <Hint>
                      The legs and the travel carry on as the body row has them; only the head, body and arms do this.
                    </Hint>
                  )}
                </>
              )}
              {clip.type === 'reach' && (
                <>
                  <div className="segmented">
                    {(['right', 'left'] as const).map((h) => (
                      <button
                        key={h}
                        className={(clip.hand ?? 'right') === h ? 'active' : ''}
                        onClick={() => setClipReach(sel.objectId, clip.id, { hand: h })}
                      >
                        {h === 'right' ? 'Right hand' : 'Left hand'}
                      </button>
                    ))}
                  </div>
                  <div className="row">
                    <button
                      className={pickingTarget ? 'primary' : 'ghost'}
                      onClick={() => useAnim.setState({ pickingTarget: !pickingTarget })}
                      title="Click a chest, a block or anything in the scene for the hand to go to"
                    >
                      <Crosshair size={14} /> {pickingTarget ? 'Click the scene…' : 'Pick target'}
                    </button>
                  </div>
                  {clip.target && (
                    <Slider
                      label="Target height"
                      min={0}
                      max={4}
                      step={0.05}
                      value={clip.target[1]}
                      onChange={(v) =>
                        setClipReach(sel.objectId, clip.id, { target: [clip.target![0], v, clip.target![2]] })
                      }
                      format={(v) => `${v.toFixed(2)} blocks`}
                    />
                  )}
                  <Hint>
                    The orange dot is where the hand goes; drag it across the ground, or pick something in the scene.
                    The arm bends to reach it (as far as the arm is long).
                  </Hint>
                </>
              )}
              {!isMoving(clip) && laneOf(clip) === 'base' && (
                <Hint>{CLIPS[clip.type].hint}. It stands where the block before it ended.</Hint>
              )}
              <button className="ghost danger" onClick={() => deleteClip(sel.objectId, clip.id)}>
                <Trash2 size={14} /> Delete block
              </button>
            </>
          )}
        </section>
      )}

      <div className="seg-wrap">
        <div className="segmented tabs" role="tablist" aria-label="What to do">
          {PANEL_TABS.map((t) => (
            <button
              key={t.id}
              role="tab"
              aria-selected={view === t.id}
              className={view === t.id ? 'active' : ''}
              onClick={() => setView(t.id)}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {view === 'add' && (
        <>
          <div className="seg-wrap">
            <div className="segmented" role="tablist" aria-label="Kind of block">
              {BLOCK_KINDS.map((k) => (
                <button
                  key={k}
                  role="tab"
                  aria-selected={kind === k}
                  className={kind === k ? 'active' : ''}
                  onClick={() => setKind(k)}
                >
                  {k}
                </button>
              ))}
            </div>
          </div>
          {kind !== 'Camera' && !(o && canWalk(o)) ? (
            <div className="anim-empty">
              <MousePointerClick size={18} />
              <span>Pick a character above to see what it can do.</span>
            </div>
          ) : kind !== 'Camera' ? (
            <div className="clip-palette">
              {CLIP_ORDER.filter((t) => (kind === 'Move' ? CLIPS[t].moves : !CLIPS[t].moves)).map((type) => {
                const def = CLIPS[type]
                const blocked = !canDo(o, type)
                return (
                  <button
                    key={type}
                    className={`clip-chip clip-${type}`}
                    disabled={blocked}
                    draggable={!blocked}
                    title={def.hint}
                    onDragStart={(e) => {
                      e.dataTransfer.setData('text/plain', type)
                      e.dataTransfer.effectAllowed = 'copy'
                      useAnim.setState({ dragType: type })
                    }}
                    onDragEnd={() => useAnim.setState({ dragType: null })}
                    onClick={() => o && addClip(o.id, type)}
                  >
                    <BlockIcon type={type} />
                    <span>{def.label}</span>
                  </button>
                )
              })}
            </div>
          ) : (
            <div className="clip-palette">
              {CAM_ORDER.map((type) => (
                <button
                  key={type}
                  className="clip-chip cam-chip"
                  draggable
                  title={CAMS[type].hint}
                  onDragStart={(e) => {
                    e.dataTransfer.setData('text/plain', type)
                    e.dataTransfer.effectAllowed = 'copy'
                    useAnim.setState({ dragType: type })
                  }}
                  onDragEnd={() => useAnim.setState({ dragType: null })}
                  onClick={() => addCamClip(type)}
                >
                  <Video size={15} />
                  <span>{CAMS[type].label}</span>
                </button>
              ))}
            </div>
          )}
          <Hint>
            {kind === 'Camera'
              ? 'Drag a camera block onto the Camera row, or click to add it at the end. With one selected, move around the viewport to set where it starts.'
              : o && canWalk(o)
                ? `Drag a block onto ${o.name}'s row in the timeline, or click one to add it at the end.`
                : 'Pick a character first, then drag blocks onto its row in the timeline.'}
          </Hint>
        </>
      )}

      {view === 'start' && (
        <>
          {o && canWalk(o) && <Suggestions id={o.id} time={time} />}
          <div className="inset-list">
            <Group id="anim:describe" title="Describe it" icon={<Wand2 size={15} />}>
              <textarea
                className="script-box"
                rows={3}
                value={script}
                placeholder="Alex walks to the cave, sees the Warden, panics, runs"
                onChange={(e) => setScript(e.target.value)}
              />
              <div className="row">
                <button
                  className="ghost"
                  disabled={!script.trim() || !characters.length}
                  onClick={() => draftFromText(script)}
                  title="Turns the sentence into blocks on the timeline that you can change"
                >
                  <Wand2 size={14} /> Draft it
                </button>
              </div>
              <Hint>
                A first draft out of ordinary blocks: walking, running, waving, panicking and so on, going to things in
                the scene by name, and camera moves ("the camera orbits Alex").
              </Hint>
            </Group>

            <Group id="anim:goto" title="Go to a spot" icon={<Navigation size={15} />}>
              <div className="segmented">
                {(['sneak', 'walk', 'run', 'sprint'] as const).map((g) => (
                  <button
                    key={g}
                    className={travel === g ? 'active' : ''}
                    onClick={() => useAnim.setState({ travel: g })}
                  >
                    {GAITS[g].label}
                  </button>
                ))}
              </div>
              <div className="row">
                <button
                  className={goingTo ? 'primary' : 'ghost'}
                  disabled={!o || !canWalk(o)}
                  onClick={() => useAnim.setState({ goingTo: !goingTo, addingPoints: false, pickingTarget: false })}
                  title="Click a spot in the scene: it finds the way there over steps, water, ladders and gaps"
                >
                  <Navigation size={14} /> {goingTo ? 'Click where to go…' : 'Go to a spot'}
                </button>
              </div>
              <Hint>
                It lays the way on the timeline as ordinary blocks (Walk, Swim, Climb, Leap) that you can drag, stretch
                or delete.
              </Hint>
            </Group>

            <PresetsSection
              objectId={o && canWalk(o) ? o.id : null}
              clipId={sel?.objectId === o?.id ? sel?.clipId : undefined}
            />
          </div>
        </>
      )}

      {view === 'tune' && (
        <div className="inset-list">
          {o && o.kind === 'player' && byBlocks && (
            <>
              <Group id="anim:looks" title="Looks" icon={<Eye size={15} />}>
                <label className="field">
                  <span>
                    <Eye size={13} /> Looks at
                  </span>
                  <select
                    value={track?.look?.target ?? ''}
                    onChange={(e) =>
                      setLook(
                        o.id,
                        e.target.value ? { target: e.target.value, amount: track?.look?.amount ?? 1 } : null
                      )
                    }
                  >
                    <option value="">Straight ahead</option>
                    <option value="camera">The camera</option>
                    {characters
                      .filter((c) => c.id !== o.id)
                      .map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                  </select>
                </label>
                {track?.look && (
                  <Slider
                    label="How much"
                    min={0}
                    max={1}
                    step={0.05}
                    value={track.look.amount}
                    onChange={(amount) => setLook(o.id, { ...track.look!, amount })}
                    format={(v) => `${Math.round(v * 100)}%`}
                  />
                )}
                <Toggle label="Breathes" checked={track?.breathe !== false} onChange={(on) => setBreathe(o.id, on)} />
                {animation.audio && (
                  <>
                    <Toggle
                      label="Talks along with the sound"
                      checked={!!track?.talk}
                      onChange={(on) => setTalk(o.id, on ? { amount: 1 } : null)}
                    />
                    {track?.talk && (
                      <Slider
                        label="How much"
                        min={0.2}
                        max={2}
                        step={0.1}
                        value={track.talk.amount}
                        onChange={(amount) => setTalk(o.id, { amount })}
                        format={(v) => `${Math.round(v * 100)}%`}
                      />
                    )}
                  </>
                )}
              </Group>
            </>
          )}

          {o && canAnimate(o) && (
            <>
              <Group id="anim:byhand" title="By hand" icon={<DiamondPlus size={15} />}>
                {byBlocks ? (
                  <>
                    <button
                      className="ghost"
                      onClick={() => bakeClips(o.id)}
                      title="Keep the motion as plain keys and drop the blocks, to edit it by hand"
                    >
                      <Layers size={14} /> Bake to keys
                    </button>
                    <Hint>
                      {o.name} moves by blocks. Bake them into keys to pose it by hand, though the blocks are gone then.
                    </Hint>
                  </>
                ) : (
                  <>
                    <div className="row">
                      <button
                        className="ghost"
                        onClick={() => setKey(o.id)}
                        title="Save how it looks now at the playhead"
                      >
                        <DiamondPlus size={14} /> Set key at {time.toFixed(2)} s
                      </button>
                      {keyHere >= 0 && (
                        <button className="ghost" onClick={() => deleteKey(o.id, keyHere)}>
                          <DiamondMinus size={14} /> Delete key
                        </button>
                      )}
                    </div>
                    {track && (
                      <button className="ghost danger" onClick={() => clearTrack(o.id)}>
                        <Trash2 size={14} /> Remove {o.name}'s animation ({track.keys.length} keys)
                      </button>
                    )}
                    <Hint>
                      With the playhead anywhere, move, turn or pose an animated character (handles, joints or the panel
                      on the right) and it keys that moment. Click a key on the timeline to jump to it; drag it to
                      retime it.
                    </Hint>
                  </>
                )}
              </Group>
            </>
          )}

          {
            <>
              <Group id="anim:share" title="Scene, curves and files" icon={<Upload size={15} />}>
                <div className="row">
                  <button
                    className="ghost"
                    disabled={!o || o.kind !== 'player'}
                    onClick={() => o && run(() => importBlockbench(o.id))}
                    title="Give the selected player an animation made in Blockbench"
                  >
                    <Upload size={14} /> Open from Blockbench
                  </button>
                  <button
                    className="ghost"
                    disabled={!o || o.kind !== 'player' || !track}
                    onClick={() =>
                      o && run(async () => ((await exportBlockbench(o.id)) ? 'Saved the animation.' : null))
                    }
                    title="Save the selected player's animation as a Blockbench file"
                  >
                    <Download size={14} /> Save for Blockbench
                  </button>
                </div>
                <div className="row">
                  <button
                    className="ghost"
                    disabled={!o || !canWalk(o) || !track}
                    onClick={() =>
                      o && run(async () => ((await exportGlb(o.id)) ? 'Saved the model and its animation.' : null))
                    }
                    title="Save the selected character and its animation as a glTF model, to open in Blender"
                  >
                    <Box size={14} /> Save for Blender (.glb)
                  </button>
                </div>
                {shareNote && <Hint>{shareNote}</Hint>}

                <CurvesPanel />

                <ScenePanel tracks={animation.scene ?? []} />
              </Group>
            </>
          }

          <Group id="anim:sound" title="Sound" icon={<Music size={15} />}>
            <div className="row">
              <button className="ghost" onClick={() => run(importSound)}>
                <Music size={14} /> {animation.audio ? 'Change the sound' : 'Add a sound'}
              </button>
              {animation.audio && (
                <button className="ghost danger" onClick={removeSound}>
                  <Trash2 size={14} /> Remove
                </button>
              )}
            </div>
            {animation.audio ? (
              <>
                <Hint>
                  {animation.audio.name}
                  {animation.audio.bpm
                    ? `: about ${Math.round(animation.audio.bpm)} beats a minute.`
                    : ': no steady beat found.'}{' '}
                  Drag it on the timeline to move it.
                </Hint>
                <Slider
                  label="Volume"
                  min={0}
                  max={1}
                  step={0.05}
                  value={animation.audio.volume}
                  onChange={(volume) => setSound({ volume })}
                  format={(v) => `${Math.round(v * 100)}%`}
                />
                <Toggle
                  label="Snap blocks to the beat"
                  checked={animation.audio.snap && animation.audio.beats.length > 0}
                  onChange={(snap) => setSound({ snap })}
                />
              </>
            ) : (
              <Hint>
                Put the music or a voice under the animation: blocks can snap to its beat, a character can talk along
                with it, and it plays in the exported video.
              </Hint>
            )}
          </Group>

          <Group id="anim:playback" title="Playback" icon={<Play size={15} />}>
            {
              <>
                <label className="field">
                  <span>Motion trails</span>
                  <select
                    value={trails}
                    onChange={(e) => useAnim.setState({ trails: e.target.value as 'selected' | 'all' | 'off' })}
                  >
                    <option value="selected">Selected character</option>
                    <option value="all">Everyone</option>
                    <option value="off">Off</option>
                  </select>
                </label>
                <Toggle
                  label="Onion skin"
                  title="While paused, shows the selected character faintly a moment before (red) and after (green) the playhead"
                  checked={onion}
                  onChange={(on) => useAnim.setState({ onion: on })}
                />
              </>
            }
            <label className="field">
              <span>Frame rate</span>
              <select value={animation.fps} onChange={(e) => setAnimation({ fps: Number(e.target.value) })}>
                {[24, 30, 60].map((f) => (
                  <option key={f} value={f}>
                    {f} fps
                  </option>
                ))}
              </select>
            </label>
            <Toggle label="Loop" checked={animation.loop} onChange={(loop) => setAnimation({ loop })} />
          </Group>
        </div>
      )}
    </div>
  )
}

/** What the selected character could do about what is near it. */
function Suggestions({ id, time }: { id: string; time: number }): ReactNode {
  const items = suggestionsFor(id, time)
  if (!items.length) return null
  return (
    <>
      <h4>Near {objectsName(id)}</h4>
      <div className="clip-palette">
        {items.map((s) => (
          <button key={s.id} className="clip-chip" onClick={s.run}>
            {s.label}
          </button>
        ))}
      </div>
    </>
  )
}

const objectsName = (id: string): string => useStore.getState().objects.find((o) => o.id === id)?.name ?? ''

const BLOCK_ICONS: Partial<Record<ClipType, LucideIcon>> = {
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
  sleep: Bed
}
function BlockIcon({ type, size = 15 }: { type: ClipType; size?: number }): ReactNode {
  const Icon = BLOCK_ICONS[type] ?? Activity
  return <Icon size={size} />
}
