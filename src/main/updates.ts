// Keeping ThumbCraft up to date from its GitHub releases. The Windows installer updates itself in the
// background (installed on the next quit). Builds that can't replace themselves (the unsigned macOS app, the
// portable .exe, Linux) just tell the user a new version is out and link to the download page.
import { app, net, type BrowserWindow } from 'electron'
import { autoUpdater } from 'electron-updater'
import { compareVersions } from '@shared/minecraft/compat'

export const RELEASES_REPO = 'Loveguard/ThumbCraft'

/** True when a > b for dotted versions like 0.2.10 vs 0.2.9 (a leading "v" is ignored). */
export const newerVersion = (a: string, b: string): boolean =>
  compareVersions(a.replace(/^v/, ''), b.replace(/^v/, '')) > 0

export function checkForUpdates(win: BrowserWindow): void {
  if (!app.isPackaged) return
  const canSelfUpdate = process.platform === 'win32' && !process.env.PORTABLE_EXECUTABLE_DIR
  if (canSelfUpdate) {
    autoUpdater.on('update-downloaded', (info) =>
      win.webContents.send('app:update', { version: info.version, ready: true, url: '' })
    )
    void autoUpdater.checkForUpdates().catch(() => undefined) // offline is fine
    return
  }
  void (async () => {
    try {
      const res = await net.fetch(`https://api.github.com/repos/${RELEASES_REPO}/releases/latest`, {
        headers: { accept: 'application/vnd.github+json' }
      })
      if (!res.ok) return
      const latest = (await res.json()) as { tag_name: string; html_url: string }
      if (newerVersion(latest.tag_name, app.getVersion()))
        win.webContents.send('app:update', {
          version: latest.tag_name.replace(/^v/, ''),
          ready: false,
          url: latest.html_url
        })
    } catch {
      // offline
    }
  })()
}
