import { useEffect, useRef, useState, type ReactNode } from 'react'
import { FolderOpen, Mountain, X } from 'lucide-react'
import type { RecentProject } from '@shared/api'
import { captureFrame, sceneSettled } from '../capture'
import { encodeExport } from '../exportImage'
import { assetUrl, loadImage } from '../minecraft/assets'
import { openProjectFile, openRecentProject } from '../projectActions'
import { useStore, type SkyPreset } from '../store'
import { applyTemplate, TEMPLATES, type Template } from '../templates'
import { timeAgo } from './ProjectMenu'

/** Card backgrounds that hint at each template's sky. */
const SKY_ART: Partial<Record<SkyPreset, string>> = {
  golden: 'linear-gradient(180deg, #f7b267 0%, #f4845f 55%, #3d6b35 55%)',
  clear: 'linear-gradient(180deg, #78a7ff 0%, #c0d8ff 55%, #e8eef2 55%)',
  sunset: 'linear-gradient(180deg, #5b3a8c 0%, #f28c52 55%, #d9c088 55%)',
  nether: 'linear-gradient(180deg, #3a0b0b 0%, #7a1d1d 55%, #8f2238 55%)',
  night: 'linear-gradient(180deg, #050816 0%, #1c2a4a 55%, #1f3a24 55%)'
}

/** A player's face, cut from a default skin in the user's own Minecraft jar. */
function SkinFace({ skin, slim }: { skin?: string; slim: boolean }): ReactNode {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const name = skin ?? (slim ? 'alex' : 'steve')
    void loadImage(assetUrl(`entity/player/${slim ? 'slim' : 'wide'}/${name}`)).then((img) => {
      const g = ref.current?.getContext('2d')
      if (!img || !g) return
      g.imageSmoothingEnabled = false
      g.drawImage(img, 8, 8, 8, 8, 0, 0, 8, 8) // face
      g.drawImage(img, 40, 8, 8, 8, 0, 0, 8, 8) // hat layer
    })
  }, [skin, slim])
  return <canvas ref={ref} width={8} height={8} className="skin-face" />
}

/** Where a template's snapshot is kept; it changes whenever the template itself does, so old ones are ignored. */
function previewKey(t: Template): string {
  let h = 0x811c9dc5
  for (const ch of JSON.stringify(t)) h = Math.imul(h ^ ch.charCodeAt(0), 0x01000193) >>> 0
  return `tc:template-preview:${t.id}:${h.toString(36)}`
}
const readPreview = (t: Template): string | null => {
  try {
    return localStorage.getItem(previewKey(t))
  } catch {
    return null
  }
}

/**
 * Remembers what a template really looks like: once its scene has finished building, a small snapshot replaces
 * the card's sketch from then on. Skipped if the user has already started changing it.
 */
async function rememberPreview(t: Template): Promise<void> {
  await sceneSettled()
  await new Promise((r) => setTimeout(r, 2500))
  const { project } = useStore.getState()
  if (project.dirty || project.name !== t.name) return
  try {
    localStorage.setItem(previewKey(t), await encodeExport(await captureFrame(384, 216), 'jpg'))
  } catch {
    /* no snapshot; the sketch stays */
  }
}

function TemplateCard({ t }: { t: Template }): ReactNode {
  const [busy, setBusy] = useState(false)
  const [snapshot] = useState(() => readPreview(t))
  const title = t.texts[0]?.text.replace(/\n/g, ' ')
  return (
    <button
      className="template-card"
      disabled={busy}
      title={t.hint}
      onClick={() => {
        setBusy(true)
        void applyTemplate(t)
          .then(() => {
            if (!snapshot) void rememberPreview(t)
          })
          .finally(() => setBusy(false))
      }}
    >
      {snapshot ? (
        <img className="template-art" src={snapshot} alt="" />
      ) : (
        <div
          className="template-art"
          style={{
            background: t.skyColor
              ? `linear-gradient(180deg, ${t.skyColor} 0%, #0d0d12 100%)`
              : (SKY_ART[t.sky] ?? SKY_ART.clear)
          }}
        >
          <div className="faces">
            {t.players.slice(0, 2).map((p, i) => (
              <SkinFace key={i} skin={p.skin} slim={p.slim ?? p.name === 'Alex'} />
            ))}
          </div>
          {title && <span style={{ color: t.texts[0].color }}>{title}</span>}
        </div>
      )}
      <strong>{t.name}</strong>
      <em>{busy ? 'Setting up…' : t.hint}</em>
    </button>
  )
}

const SECRET_KEY = 'tc:secret-scenes'
/** FNV-1a of the code's letters, lowercased (so spacing and capitals don't matter). */
const SECRET_HASH = 0xce24eb59
const codeHash = (code: string): number => {
  let h = 0x811c9dc5
  for (const ch of code.toLowerCase().replace(/[^a-z]/g, '')) h = Math.imul(h ^ ch.charCodeAt(0), 0x01000193) >>> 0
  return h
}
const readUnlocked = (): boolean => {
  try {
    return localStorage.getItem(SECRET_KEY) === '1'
  } catch {
    return false
  }
}

/** "Have a code?": the right one unlocks the secret scenes (remembered on this computer). */
function SecretCode({ onUnlock }: { onUnlock: () => void }): ReactNode {
  const [open, setOpen] = useState(false)
  const [code, setCode] = useState('')
  const [wrong, setWrong] = useState(false)
  if (!open)
    return (
      <button className="link secret-link" onClick={() => setOpen(true)}>
        Have a code?
      </button>
    )
  const submit = (): void => {
    if (codeHash(code) !== SECRET_HASH) {
      setWrong(true)
      return
    }
    try {
      localStorage.setItem(SECRET_KEY, '1')
    } catch {
      /* still unlocked for this session */
    }
    onUnlock()
  }
  return (
    <form
      className="secret-code"
      onSubmit={(e) => {
        e.preventDefault()
        submit()
      }}
    >
      <input
        autoFocus
        value={code}
        placeholder="Enter a code"
        onChange={(e) => {
          setCode(e.target.value)
          setWrong(false)
        }}
      />
      <button type="submit">Unlock</button>
      {wrong && <span className="warn">That code doesn't unlock anything.</span>}
    </form>
  )
}

/** Shown over an empty canvas: pick up where you left off, open a file, or just start adding things. */
export function StartPanel(): ReactNode {
  const empty = useStore((s) => s.objects.length === 0)
  const [recent, setRecent] = useState<RecentProject[] | null>(null)
  const [hidden, setHidden] = useState(false)
  const [unlocked, setUnlocked] = useState(readUnlocked)

  useEffect(() => {
    if (empty) void window.blockframe.recentProjects().then(setRecent)
  }, [empty])

  if (!empty || hidden) return null
  return (
    <div className="start-panel">
      <button className="icon-btn sm close" title="Hide" onClick={() => setHidden(true)}>
        <X size={15} />
      </button>
      <h2>Start a thumbnail</h2>
      <p>Pick a ready-made layout (instant, no world generation), then change the text and add your own skin.</p>
      <div className="template-grid">
        {TEMPLATES.filter((t) => !t.secret).map((t) => (
          <TemplateCard key={t.id} t={t} />
        ))}
      </div>
      {unlocked ? (
        <>
          <h4 className="secret-title">Loveguard's thumbnails</h4>
          <div className="template-grid">
            {TEMPLATES.filter((t) => t.secret).map((t) => (
              <TemplateCard key={t.id} t={t} />
            ))}
          </div>
        </>
      ) : (
        <SecretCode onUnlock={() => setUnlocked(true)} />
      )}
      <div className="row">
        <button onClick={() => document.querySelector<HTMLButtonElement>('.rail-item')?.click()}>
          <Mountain size={16} /> Generate a real biome
        </button>
        <button onClick={() => void openProjectFile()}>
          <FolderOpen size={16} /> Open project…
        </button>
      </div>
      {recent && recent.length > 0 && (
        <>
          <h4>Recent projects</h4>
          <div className="recent-grid">
            {recent.slice(0, 6).map((r) => (
              <div key={r.id} className="recent-card">
                <button
                  className="recent-open"
                  onClick={() => void openRecentProject(r.id)}
                  title={r.savedPath ?? 'Recovered automatically'}
                >
                  {r.thumbnail ? <img src={r.thumbnail} alt="" /> : <div className="thumb-empty" />}
                  <strong>{r.name}</strong>
                  <span>
                    {timeAgo(r.updatedAt)}
                    {r.savedPath ? '' : ' · not saved yet'}
                  </span>
                </button>
                <button
                  className="icon-btn sm forget"
                  title="Remove from recent (deletes the recovery copy)"
                  onClick={() =>
                    void window.blockframe
                      .forgetRecent(r.id)
                      .then(() => setRecent((list) => list?.filter((x) => x.id !== r.id) ?? null))
                  }
                >
                  <X size={13} />
                </button>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
