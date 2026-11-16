import { useEffect, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { RefreshCw, X } from 'lucide-react'
import { captureFrame, eachTab } from '../capture'
import { useStore } from '../store'
import { tabProject, useTabs } from '../tabs'

interface Variant {
  label: string
  url: string
}

/** Grey stand-ins for the other videos around yours, so you judge the thumbnail in context. */
const FILLER = ['#3a4a5c', '#5c3a3a', '#3a5c45', '#5c553a', '#4a3a5c']

function Thumb({
  url,
  width,
  duration,
  filler
}: {
  url?: string
  width: number | string
  duration: string
  filler?: string
}): ReactNode {
  return (
    <div className="ytp-thumb" style={{ width }}>
      {url ? <img src={url} alt="" /> : <div className="ytp-filler" style={{ background: filler }} />}
      <span className="ytp-duration">{duration}</span>
    </div>
  )
}

function Lines({ n = 2 }: { n?: number }): ReactNode {
  return (
    <div className="ytp-lines">
      {Array.from({ length: n }, (_, i) => (
        <i key={i} style={{ width: `${90 - i * 30}%` }} />
      ))}
    </div>
  )
}

/**
 * How the thumbnail reads where people actually see it: the home feed, search results, the "up next" list beside a
 * video and a phone, in light or dark mode, with the video-length badge in its corner. With several projects open
 * (tabs), each one is rendered so the variants can be compared side by side.
 */
export function YouTubePreview({ onClose }: { onClose: () => void }): ReactNode {
  const projectName = useStore((s) => s.project.name)
  const [title, setTitle] = useState(projectName)
  const [channel, setChannel] = useState('Your channel')
  const [duration, setDuration] = useState('12:34')
  const [dark, setDark] = useState(true)
  const [variants, setVariants] = useState<Variant[]>([])
  const [pick, setPick] = useState(0)
  const [busy, setBusy] = useState(false)

  const render = async (): Promise<void> => {
    setBusy(true)
    try {
      // The project on screen first, then the other open ones.
      const { tabs, active } = useTabs.getState()
      const keys = [active, ...tabs.map((t) => t.key).filter((k) => k !== active)]
      const names = keys.map((k) => tabProject(tabs.find((t) => t.key === k)!).name)
      const urls = await eachTab(keys, () => captureFrame(640, 360))
      setVariants(urls.map((url, i) => ({ url, label: names[i] })))
    } finally {
      setBusy(false)
    }
  }
  useEffect(() => {
    void render()
    const key = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const chosen = variants[Math.min(pick, variants.length - 1)]
  const meta = <span className="ytp-meta">{channel} · 24K views · 2 hours ago</span>
  const avatar = <span className="ytp-avatar">{channel.trim().charAt(0).toUpperCase() || '?'}</span>
  // On the page itself: the top bar's blur would otherwise trap a fixed-position window inside it.
  return createPortal(
    <div
      className="ytp-backdrop"
      role="dialog"
      aria-label="YouTube preview"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className={`ytp ${dark ? 'dark' : 'light'}`}>
        <header className="ytp-bar">
          <strong>How it looks on YouTube</strong>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Video title"
            title="Video title"
          />
          <input className="short" value={channel} onChange={(e) => setChannel(e.target.value)} title="Channel name" />
          <input className="tiny" value={duration} onChange={(e) => setDuration(e.target.value)} title="Video length" />
          <div className="segmented sm ytp-mode">
            <button className={dark ? 'active' : ''} onClick={() => setDark(true)}>
              Dark
            </button>
            <button className={dark ? '' : 'active'} onClick={() => setDark(false)}>
              Light
            </button>
          </div>
          <button className="icon-btn" title="Render again" disabled={busy} onClick={() => void render()}>
            <RefreshCw size={16} />
          </button>
          <button className="icon-btn" title="Close (Esc)" onClick={onClose}>
            <X size={16} />
          </button>
        </header>
        {!variants.length ? (
          <div className="ytp-loading">Rendering your thumbnails…</div>
        ) : (
          <div className="ytp-body">
            <section>
              <h3>Home feed</h3>
              <div className="ytp-grid">
                {[
                  ...variants.map((s) => s as Variant | null),
                  ...Array.from({ length: Math.max(0, 6 - variants.length) }, () => null)
                ].map((s, i) => (
                  <div key={i} className="ytp-card">
                    <Thumb
                      url={s?.url}
                      width="100%"
                      duration={s ? duration : `${8 + i}:0${i}`}
                      filler={FILLER[i % FILLER.length]}
                    />
                    <div className="ytp-info">
                      {s ? avatar : <span className="ytp-avatar filler" />}
                      {s ? (
                        <div>
                          <span className="ytp-title">{title}</span>
                          {meta}
                          {variants.length > 1 && <span className="ytp-tag">{s.label}</span>}
                        </div>
                      ) : (
                        <Lines />
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </section>
            {variants.length > 1 && (
              <div className="ytp-pick" title="Which project the views below show">
                {variants.map((s, i) => (
                  <button key={i} className={i === pick ? 'active' : ''} onClick={() => setPick(i)}>
                    {s.label}
                  </button>
                ))}
              </div>
            )}
            <div className="ytp-row">
              <section className="ytp-search">
                <h3>Search results</h3>
                <div className="ytp-result">
                  <Thumb url={chosen?.url} width={360} duration={duration} />
                  <div>
                    <span className="ytp-title big">{title}</span>
                    {meta}
                    <span className="ytp-channel">
                      {avatar} {channel}
                    </span>
                  </div>
                </div>
                <div className="ytp-result">
                  <Thumb width={360} duration="18:02" filler={FILLER[1]} />
                  <Lines n={3} />
                </div>
              </section>
              <section className="ytp-side">
                <h3>Up next (beside a video)</h3>
                {[null, chosen, null].map((s, i) => (
                  <div key={i} className="ytp-side-item">
                    <Thumb
                      url={s?.url}
                      width={168}
                      duration={s ? duration : '9:41'}
                      filler={FILLER[(i + 2) % FILLER.length]}
                    />
                    {s ? (
                      <div>
                        <span className="ytp-title small">{title}</span>
                        <span className="ytp-meta">{channel}</span>
                      </div>
                    ) : (
                      <Lines />
                    )}
                  </div>
                ))}
              </section>
              <section className="ytp-phone-wrap">
                <h3>Phone</h3>
                <div className="ytp-phone">
                  <Thumb url={chosen?.url} width="100%" duration={duration} />
                  <div className="ytp-info">
                    {avatar}
                    <div>
                      <span className="ytp-title">{title}</span>
                      {meta}
                    </div>
                  </div>
                  <Thumb width="100%" duration="7:15" filler={FILLER[3]} />
                </div>
              </section>
            </div>
            <p className="ytp-hint">
              YouTube puts the video length in the bottom-right corner, so keep faces and text clear of it. In "Up next"
              your thumbnail is only 168 pixels wide: if the title text is hard to read there, make it bigger or
              shorter.
            </p>
          </div>
        )}
      </div>
    </div>,
    document.body
  )
}
