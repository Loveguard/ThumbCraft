import { useEffect, useState, type ReactNode } from 'react'
import { useStore } from '../store'
import { errorText } from '../errors'
import logo from '../assets/logo.png'

/** Startup screen: loads the newest Minecraft on this computer; only asks for help when there is none. */
export function Setup(): ReactNode {
  const [missing, setMissing] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const load = async (jarPath: string): Promise<void> => {
    setLoading(true)
    setError('')
    try {
      useStore.getState().setAssets(await window.blockframe.loadJar(jarPath))
    } catch (e) {
      setError(errorText(e))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void window.blockframe
      .loadNewest()
      .then((bundle) => (bundle ? useStore.getState().setAssets(bundle) : setMissing(true)))
      .catch((e) => {
        setError(errorText(e))
        setMissing(true)
      })
  }, [])

  return (
    <div className="setup">
      <div className="setup-card">
        <div className="setup-brand">
          <img src={logo} alt="" />
          <h1>ThumbCraft</h1>
        </div>
        {!missing ? (
          <p className="hint">Loading your newest Minecraft…</p>
        ) : (
          <>
            <p>
              Blocks, models, textures and biome colours are read from your own copy of Minecraft: Java Edition, but
              none was found on this computer. Get the latest version from Mojang, or point to a client .jar.
            </p>
            <DownloadFromMojang onReady={(jar) => void load(jar)} busy={loading} />
            <button
              disabled={loading}
              onClick={async () => {
                const p = await window.blockframe.pickJar()
                if (p) void load(p)
              }}
            >
              Choose a client .jar…
            </button>
            <p className="hint">Works with Minecraft 1.18 or newer.</p>
          </>
        )}
        {error && <p className="warn">{error}</p>}
        <p className="disclaimer">
          NOT AN OFFICIAL MINECRAFT PRODUCT. NOT APPROVED BY OR ASSOCIATED WITH MOJANG OR MICROSOFT.
        </p>
      </div>
    </div>
  )
}

/** For people without a launcher folder: fetch the latest official client jar straight from Mojang. */
function DownloadFromMojang({ onReady, busy }: { onReady: (jar: string) => void; busy: boolean }): ReactNode {
  const [progress, setProgress] = useState('')
  const [error, setError] = useState('')
  const [working, setWorking] = useState(false)
  useEffect(() => window.blockframe.onClientProgress(setProgress), [])
  return (
    <div className="download-client">
      <button
        className="primary"
        disabled={working || busy}
        onClick={async () => {
          setWorking(true)
          setError('')
          try {
            onReady(await window.blockframe.downloadClient())
          } catch (e) {
            setError(`Couldn't download Minecraft: ${errorText(e)}`)
          } finally {
            setWorking(false)
            setProgress('')
          }
        }}
      >
        {working ? 'Downloading…' : 'Download the latest Minecraft'}
      </button>
      {progress && <p className="hint">{progress}</p>}
      {error && <p className="warn">{error}</p>}
      <p className="hint">
        The official game file (about 30 MB) comes straight from Mojang's servers, the same way the launcher gets it.
        You should own Minecraft: Java Edition.
      </p>
    </div>
  )
}
