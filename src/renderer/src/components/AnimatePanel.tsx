// The Animation mode's side panel. It reads top to bottom the way a first animation is made: pick a character,
// start from a scene (or describe one), then add what happens next. The block picked on the timeline opens right
// under the characters, and everything deeper (sound, keys by hand, curves, files) is folded away below.
import { useState, type ReactNode } from 'react'
import {
  Box,
  Camera,
  Crosshair,
  DiamondMinus,
  DiamondPlus,
  Download,
  Eye,
  Layers,
  MapPin,
  MousePointerClick,
  Music,
  Navigation,
  PenLine,
  Play,
  Route,
  Search,
  Sparkles,
  Trash2,
  Undo2,
  Upload,
  User,
  Video,
  Wand2,
  X
} from 'lucide-react'
import { useShallow } from 'zustand/react/shallow'
import { CAM_ORDER, CAMS, type CamType } from '@shared/camera'
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
  type ClipEase,
  type ClipMode,
  type ClipType,
  ACTION_GROUPS
} from '@shared/animation'
import { STARTER_PRESETS } from '@shared/presets'
import {
  addCamClip,
  addClipAndPlay,
  applyPresetAndPlay,
  bakeClips,
  camClipOf,
  canAnimate,
  canDo,
  canWalk,
  clearTrack,
  clipOf,
  deleteClip,
  deleteKey,
  draftFromText,
  followPrevious,
  playFrom,
  removePathPoint,
  resetPath,
  setAnimation,
  setBreathe,
  setCamClip,
  setClipAuto,
  setClipDuration,
  setClipEase,
  setClipLayer,
  setClipMode,
  setClipReach,
  setClipType,
  setKey,
  setLook,
  setShotHere,
  setTalk,
  suggestionsFor,
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
import { BlockIcon } from './blockIcons'

const MOVING: ClipType[] = ['walk', 'run', 'sprint', 'sneak']
const MOVES = CLIP_ORDER.filter((t) => CLIPS[t].moves)
const MODE_LABEL: Record<ClipMode, string> = { loop: 'Repeat', once: 'Play once', hold: 'Freeze at the end' }
const MODE_HINT: Record<ClipMode, string> = {
  loop: 'Does it over and over to fill the block',
  once: 'Does it once, stretched to the block',
  hold: 'Goes into it and stays there'
}
const EASES: [ClipEase, string, string][] = [
  ['snappy', 'Snappy', 'Snaps into it and out of it'],
  ['smooth', 'Smooth', 'Eases in with a little bounce (the usual)'],
  ['gentle', 'Gentle', 'Drifts in and out slowly']
]
const COACH_KEY = 'thumbcraft.animCoach'

const readCoach = (): boolean => {
  try {
    return localStorage.getItem(COACH_KEY) !== 'done'
  } catch {
    return false
  }
}

export function AnimatePanel(): ReactNode {
  const [script, setScript] = useState('')
  const [find, setFind] = useState('')
  const [coach, setCoach] = useState(readCoach)
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
  const { time, sel, selectedPoint, addingPoints, pickingTarget, goingTo, drawing, travel, gaits, trails, onion } =
    useAnim(
      useShallow((a) => ({
        gaits: a.gaits,
        time: a.time,
        sel: a.selectedClip,
        selectedPoint: a.selectedPoint,
        addingPoints: a.addingPoints,
        pickingTarget: a.pickingTarget,
        goingTo: a.goingTo,
        drawing: a.drawing,
        travel: a.travel,
        trails: a.trails,
        onion: a.onion
      }))
    )
  const select = useStore((s) => s.select)
  const openTab = useLayout((s) => s.openAssetTab)
  const o = objects.find((x) => x.id === selectedId)
  const who = o && canWalk(o) ? o : undefined
  const track = animation.tracks.find((t) => t.objectId === selectedId)
  const characters = objects.filter(canWalk)
  const keyHere = track ? keyAt(track.keys, time) : -1
  const clip = clipOf(sel)
  const cam = camClipOf(sel)
  const clipObject = clip && objects.find((x) => x.id === sel?.objectId)
  const byBlocks = !!track?.clips?.length
  const anything = animation.tracks.length > 0 || !!animation.camera?.clips.length
  const q = find.trim().toLowerCase()
  const shown = (types: ClipType[]): ClipType[] =>
    types.filter((t) => !q || CLIPS[t].label.toLowerCase().includes(q) || t.includes(q))
  const cams = CAM_ORDER.filter((t) => !q || CAMS[t].label.toLowerCase().includes(q))
  const endCoach = (): void => {
    setCoach(false)
    try {
      localStorage.setItem(COACH_KEY, 'done')
    } catch {
      // Private window: it just shows again next time.
    }
  }

  return (
    <div className="tab-body animate-panel">
      {coach && (
        <section className="anim-coach" aria-label="How Animation works">
          <div className="insp-head">
            <Sparkles size={16} />
            <strong>Your first animation in three steps</strong>
            <button className="icon-btn" title="Got it" onClick={endCoach}>
              <X size={13} />
            </button>
          </div>
          <ol>
            <li>Pick a character, then a scene to start from. It plays straight away.</li>
            <li>Click the character in the scene, or a block below, to add what it does next.</li>
            <li>Press Export video at the top when you like it.</li>
          </ol>
          <button className="ghost" onClick={endCoach}>
            Got it
          </button>
        </section>
      )}

      <div className="anim-head">
        <h4>Characters</h4>
        {anything && (
          <button className="primary" onClick={() => playFrom(0)} title="Plays the whole animation from the start">
            <Play size={14} /> Watch it
          </button>
        )}
      </div>
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

      {characters.length > 0 && (
        <div className="describe">
          <textarea
            className="script-box"
            rows={2}
            value={script}
            placeholder="Describe what happens: Alex walks to the cave, sees the Warden, panics, runs"
            onChange={(e) => setScript(e.target.value)}
          />
          <button
            className="ghost"
            disabled={!script.trim()}
            onClick={() => draftFromText(script) && playFrom(0)}
            title="Turns the sentence into blocks on the timeline that you can change"
          >
            <Wand2 size={14} /> Make it
          </button>
        </div>
      )}

      {who && !byBlocks && <Starters objectId={who.id} title={`Start ${who.name} from a scene`} />}

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
              {!['hold', 'follow', 'glide'].includes(cam.type) ? (
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
              {cam.type !== 'glide' && (
                <label className="field">
                  <span>Keep in shot</span>
                  <select
                    value={cam.subject ?? ''}
                    onChange={(e) => setCamClip(cam.id, { subject: e.target.value || null })}
                  >
                    <option value="">Nothing in particular</option>
                    {characters.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              <Hint>
                {cam.type === 'glide'
                  ? 'Glides from the shot before to this one. With it selected, move around the viewport to change where it ends.'
                  : `${cam.view ? 'This block starts from a view you set.' : 'This block starts where the one before it ended.'} With it selected, just move around the viewport and it starts from wherever you let go.`}
              </Hint>
              {cam.view && cam.type !== 'glide' ? (
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
                    <p className="hint">
                      This length is too quick for a walk, so it {GAITS[gaits[clip.id]].label.toLowerCase()}s.
                    </p>
                  )}
                </>
              )}
              {CLIPS[clip.type].modes.length > 1 && (
                <div className="segmented">
                  {CLIPS[clip.type].modes.map((m) => (
                    <button
                      key={m}
                      className={modeOf(clip) === m ? 'active' : ''}
                      title={MODE_HINT[m]}
                      onClick={() => setClipMode(sel.objectId, clip.id, m)}
                    >
                      {MODE_LABEL[m]}
                    </button>
                  ))}
                </div>
              )}
              {!isMoving(clip) && clip.type !== 'fall' && clip.type !== 'sleep' && (
                <div className="segmented" aria-label="How it eases in and out">
                  {EASES.map(([e, label, hint]) => (
                    <button
                      key={e}
                      className={(clip.ease ?? 'smooth') === e ? 'active' : ''}
                      title={hint}
                      onClick={() => setClipEase(sel.objectId, clip.id, e)}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              )}
              {clip.type === 'pose' && (
                <p className="hint">
                  Pose {clipObject.name} now: drag its joints in the scene, or use the pose controls on the right. It
                  goes into this pose and holds it for the whole block.
                </p>
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
                      title="The whole character does this, standing where the block before it ended"
                      onClick={() => setClipLayer(sel.objectId, clip.id, undefined)}
                    >
                      Whole body
                    </button>
                    <button
                      className={laneOf(clip) === 'upper' ? 'active' : ''}
                      title="Only the arms and head do this, over a walk, run or jump"
                      onClick={() => setClipLayer(sel.objectId, clip.id, 'upper')}
                    >
                      Arms and head
                    </button>
                  </div>
                  {laneOf(clip) === 'upper' && (
                    <p className="hint">The legs carry on with the row below; only the head, body and arms do this.</p>
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
              {!isMoving(clip) && clip.type !== 'pose' && laneOf(clip) === 'base' && (
                <Hint>{CLIPS[clip.type].hint}. It stands where the block before it ended.</Hint>
              )}
              <button className="ghost danger" onClick={() => deleteClip(sel.objectId, clip.id)}>
                <Trash2 size={14} /> Delete block
              </button>
            </>
          )}
        </section>
      )}

      <h4 className="next-title">What happens next?</h4>
      <label className="anim-find">
        <Search size={14} />
        <input value={find} placeholder="Find a move, an action or a shot" onChange={(e) => setFind(e.target.value)} />
      </label>

      {!who ? (
        <div className="anim-empty">
          <MousePointerClick size={18} />
          <span>Pick a character above (or click one in the scene) to see what it can do.</span>
        </div>
      ) : (
        <>
          {!q && <Suggestions id={who.id} time={time} />}
          {shown(MOVES).length > 0 && (
            <>
              <h5>Move</h5>
              <div className="row">
                <button
                  className={drawing ? 'primary' : 'ghost'}
                  onClick={() => useAnim.setState({ drawing: !drawing, addingPoints: false, goingTo: false })}
                  title="Drag across the ground in the scene to draw where it walks"
                >
                  <PenLine size={14} /> {drawing ? 'Drag across the ground…' : 'Draw a walk'}
                </button>
                <button
                  className={goingTo ? 'primary' : 'ghost'}
                  onClick={() => useAnim.setState({ goingTo: !goingTo, addingPoints: false, drawing: false })}
                  title="Click a spot in the scene: it finds the way there over steps, water, ladders and gaps"
                >
                  <Navigation size={14} /> {goingTo ? 'Click where to go…' : 'Go to a spot'}
                </button>
              </div>
              {goingTo && (
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
              )}
              <Chips types={shown(MOVES)} objectId={who.id} />
            </>
          )}
          {ACTION_GROUPS.map(([title, types]) =>
            shown(types).length ? (
              <div key={title}>
                <h5>{title}</h5>
                <Chips types={shown(types)} objectId={who.id} />
              </div>
            ) : null
          )}
        </>
      )}

      {cams.length > 0 && (
        <>
          <h5>Camera</h5>
          <div className="row">
            <button
              className="primary"
              onClick={setShotHere}
              title="Keeps the view as it is now as a shot; press it again after moving the view to glide there"
            >
              <Camera size={14} /> Set shot here
            </button>
          </div>
          <div className="clip-palette">
            {cams.map((type) => (
              <CamChip key={type} type={type} />
            ))}
          </div>
        </>
      )}
      <Hint>
        Click a block to add it at the end, or drag it onto a row in the timeline. Ctrl+Z undoes anything, here or in
        the scene.
      </Hint>

      <div className="inset-list">
        {who && byBlocks && (
          <Group id="anim:starters" title="Add a scene" icon={<Sparkles size={15} />}>
            <Starters objectId={who.id} />
          </Group>
        )}
        <PresetsSection objectId={who?.id ?? null} clipId={sel?.objectId === o?.id ? sel?.clipId : undefined} />

        {o && o.kind === 'player' && byBlocks && (
          <Group id="anim:looks" title="Looks" icon={<Eye size={15} />}>
            <label className="field">
              <span>
                <Eye size={13} /> Looks at
              </span>
              <select
                value={track?.look?.target ?? ''}
                onChange={(e) =>
                  setLook(o.id, e.target.value ? { target: e.target.value, amount: track?.look?.amount ?? 1 } : null)
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
        )}

        {o && canAnimate(o) && (
          <Group id="anim:byhand" title="Keys by hand" icon={<DiamondPlus size={15} />}>
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
                  {o.name} moves by blocks. To hold a pose, add a Pose block. Bake to keys turns the blocks into plain
                  keys to edit one by one (the blocks are gone then).
                </Hint>
              </>
            ) : (
              <>
                <div className="row">
                  <button className="ghost" onClick={() => setKey(o.id)} title="Save how it looks now at the playhead">
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
                  With the playhead anywhere, move, turn or pose the character (handles, joints or the panel on the
                  right) and it keys that moment. Click a key on the timeline to jump to it; drag it to retime it.
                </Hint>
              </>
            )}
          </Group>
        )}

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
              <p className="hint">
                {animation.audio.name}
                {animation.audio.bpm
                  ? `: about ${Math.round(animation.audio.bpm)} beats a minute.`
                  : ': no steady beat found.'}{' '}
                Drag it on the timeline to move it.
              </p>
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
              Put the music or a voice under the animation: blocks can snap to its beat, a character can talk along with
              it, and it plays in the exported video.
            </Hint>
          )}
        </Group>

        <Group id="anim:share" title="Curves, scene and files" icon={<Upload size={15} />}>
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
              onClick={() => o && run(async () => ((await exportBlockbench(o.id)) ? 'Saved the animation.' : null))}
              title="Save the selected player's animation as a Blockbench file"
            >
              <Download size={14} /> Save for Blockbench
            </button>
          </div>
          <div className="row">
            <button
              className="ghost"
              disabled={!who || !track}
              onClick={() =>
                who && run(async () => ((await exportGlb(who.id)) ? 'Saved the model and its animation.' : null))
              }
              title="Save the selected character and its animation as a glTF model, to open in Blender"
            >
              <Box size={14} /> Save for Blender (.glb)
            </button>
          </div>
          {shareNote && <p className="hint">{shareNote}</p>}
          <CurvesPanel />
          <ScenePanel tracks={animation.scene ?? []} />
        </Group>

        <Group id="anim:playback" title="Playback" icon={<Play size={15} />}>
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
          <Toggle label="Play it on repeat" checked={animation.loop} onChange={(loop) => setAnimation({ loop })} />
        </Group>
      </div>
    </div>
  )
}

/** Ready-made scenes: one click puts their blocks on the character and plays them. */
function Starters({ objectId, title }: { objectId: string; title?: string }): ReactNode {
  const o = useStore((s) => s.objects.find((x) => x.id === objectId))
  const usable = STARTER_PRESETS.filter((p) => p.clips.every((c) => canDo(o, c.type)))
  if (!usable.length) return null
  return (
    <>
      {title && <h4>{title}</h4>}
      <div className="starter-grid">
        {usable.map((p) => (
          <button
            key={p.id}
            className="starter-card"
            title={`${p.clips.map((c) => CLIPS[c.type].label).join(', then ')}. ${p.duration.toFixed(1)} s.`}
            onClick={() => applyPresetAndPlay(p, objectId)}
          >
            <span className="starter-icons">
              {p.clips.slice(0, 4).map((c, i) => (
                <BlockIcon key={i} type={c.type} size={14} />
              ))}
            </span>
            <strong>{p.name}</strong>
            <em>{p.duration.toFixed(1)} s</em>
          </button>
        ))}
      </div>
    </>
  )
}

/** Blocks to click (added at the end, played straight away) or drag onto the timeline. */
function Chips({ types, objectId }: { types: ClipType[]; objectId: string }): ReactNode {
  const o = useStore((s) => s.objects.find((x) => x.id === objectId))
  return (
    <div className="clip-palette">
      {types.map((type) => {
        const blocked = !canDo(o, type)
        return (
          <button
            key={type}
            className={`clip-chip clip-${type}`}
            disabled={blocked}
            draggable={!blocked}
            title={CLIPS[type].hint}
            onDragStart={(e) => dragBlock(e, type)}
            onDragEnd={() => useAnim.setState({ dragType: null })}
            onClick={() => addClipAndPlay(objectId, type)}
          >
            <BlockIcon type={type} />
            <span>{CLIPS[type].label}</span>
          </button>
        )
      })}
    </div>
  )
}

function CamChip({ type }: { type: CamType }): ReactNode {
  return (
    <button
      className="clip-chip cam-chip"
      draggable
      title={CAMS[type].hint}
      onDragStart={(e) => dragBlock(e, type)}
      onDragEnd={() => useAnim.setState({ dragType: null })}
      onClick={() => addCamClip(type)}
    >
      <Video size={15} />
      <span>{CAMS[type].label}</span>
    </button>
  )
}

function dragBlock(e: React.DragEvent, type: ClipType | CamType): void {
  e.dataTransfer.setData('text/plain', type)
  e.dataTransfer.effectAllowed = 'copy'
  useAnim.setState({ dragType: type })
}

/** What the selected character could do about what is near it. */
function Suggestions({ id, time }: { id: string; time: number }): ReactNode {
  const items = suggestionsFor(id, time)
  const name = useStore((s) => s.objects.find((o) => o.id === id)?.name ?? '')
  if (!items.length) return null
  return (
    <>
      <h5>Near {name}</h5>
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
