import { useEffect, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import { version } from '../../../../package.json'

const REPO = 'https://github.com/Loveguard/ThumbCraft'

/** Fonts bundled with the app for titles; each keeps its own licence (full texts in THIRD_PARTY_NOTICES). */
const FONTS: [string, string][] = [
  ['Inter', 'OFL 1.1'],
  ['Anton', 'OFL 1.1'],
  ['Bebas Neue', 'OFL 1.1'],
  ['Bungee', 'OFL 1.1'],
  ['Lilita One', 'OFL 1.1'],
  ['Luckiest Guy', 'Apache 2.0'],
  ['Russo One', 'OFL 1.1'],
  ['Titan One', 'OFL 1.1']
]

/** Version, the unofficial-product notice and the licences of what ships inside the app. */
export function AboutDialog({ onClose }: { onClose: () => void }): ReactNode {
  useEffect(() => {
    const key = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [onClose])
  return createPortal(
    <div className="about-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="about" role="dialog" aria-label="About ThumbCraft">
        <header>
          <strong>ThumbCraft {version}</strong>
          <button className="icon-btn" title="Close (Esc)" onClick={onClose}>
            <X size={16} />
          </button>
        </header>
        <p className="about-notice">
          NOT AN OFFICIAL MINECRAFT PRODUCT. NOT APPROVED BY OR ASSOCIATED WITH MOJANG OR MICROSOFT.
        </p>
        <p>
          Minecraft is a trademark of Mojang Studios. ThumbCraft contains no Minecraft game files: textures, models, the
          Minecraft font and the world generator are read from your own copy of the game, or downloaded from Mojang's
          servers into it. YouTube is a trademark of Google; the YouTube preview is a mock-up for planning and not
          connected to YouTube.
        </p>
        <p>
          The thumbnails you make are yours. Mind the{' '}
          <a href="https://www.minecraft.net/en-us/usage-guidelines" target="_blank" rel="noreferrer">
            Minecraft usage guidelines
          </a>{' '}
          when you publish them.
        </p>
        <h4>Licences</h4>
        <p>
          ThumbCraft is open source under the{' '}
          <a href={`${REPO}/blob/main/LICENSE`} target="_blank" rel="noreferrer">
            MIT licence
          </a>
          . Title fonts are free to use in your thumbnails, including commercially:
        </p>
        <ul className="about-fonts">
          {FONTS.map(([name, licence]) => (
            <li key={name}>
              <span style={{ fontFamily: `'${name}', '${name} Variable'` }}>{name}</span>
              <em>{licence}</em>
            </li>
          ))}
        </ul>
        <p>
          three.js, React, MediaPipe (background removal) and the other libraries keep their own licences, listed with
          their full texts in{' '}
          <a href={`${REPO}/blob/main/THIRD_PARTY_NOTICES.md`} target="_blank" rel="noreferrer">
            THIRD_PARTY_NOTICES
          </a>{' '}
          (also installed next to the app).
        </p>
      </div>
    </div>,
    document.body
  )
}
