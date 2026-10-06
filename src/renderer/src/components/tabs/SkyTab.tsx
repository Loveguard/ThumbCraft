import { useRef, type ReactNode } from 'react'
import { CloudRain, Snowflake, Sun, Upload, Zap } from 'lucide-react'
import { placeNew } from '../../placement'
import { registerMedia } from '../../media'
import { DAY_LIGHTING, NIGHT_LIGHTING, newId, useStore, type SkyPreset, type WeatherType } from '../../store'
import { sunInView } from '../Effects'
import { PRESET_SUN } from '../SkyBackdrop'
import { viewport } from '../Viewport'
import { Hint } from '../controls'

const PRESETS: { id: SkyPreset; label: string; hint: string; swatch: string }[] = [
  {
    id: 'biome',
    label: 'Vanilla',
    hint: 'Minecraft’s own sky colour for the biome',
    swatch: 'linear-gradient(#78a7ff, #b9d0ff)'
  },
  {
    id: 'clear',
    label: 'Clear day',
    hint: 'Bright blue sky with light clouds',
    swatch: 'linear-gradient(#3d7bd9, #a9cdf5 70%, #e9f1fb)'
  },
  {
    id: 'golden',
    label: 'Golden hour',
    hint: 'Low warm sun, long light',
    swatch: 'linear-gradient(#5c86c9, #f2c486 70%, #ffd8a0)'
  },
  {
    id: 'sunset',
    label: 'Sunset',
    hint: 'Sun on the horizon, orange and pink',
    swatch: 'linear-gradient(#2c3e73, #d9786a 60%, #ffb26b)'
  },
  {
    id: 'overcast',
    label: 'Overcast',
    hint: 'Soft grey clouds, no harsh shadows',
    swatch: 'linear-gradient(#8e98a3, #c4cad0)'
  },
  {
    id: 'night',
    label: 'Night',
    hint: 'Stars and the game’s full moon',
    swatch: 'radial-gradient(circle at 70% 30%, #e8e8d8 0 6%, transparent 7%), linear-gradient(#03050c, #141d38)'
  },
  { id: 'nether', label: 'Nether', hint: 'The Nether’s fog colour', swatch: 'linear-gradient(#3a0b0b, #6b1d12)' },
  { id: 'end', label: 'The End', hint: 'The game’s End sky texture', swatch: 'linear-gradient(#120d1a, #2a2236)' },
  {
    id: 'color',
    label: 'Solid colour',
    hint: 'Any flat colour (great for cut-outs)',
    swatch: 'linear-gradient(135deg, #ff5f6d, #ffc371)'
  }
]

const SKY_TYPES: Record<string, string> = {
  hdr: 'image/vnd.radiance',
  exr: 'image/x-exr',
  png: 'image/png',
  webp: 'image/webp'
}

export function SkyTab(): ReactNode {
  const sky = useStore((s) => s.sky)
  const renderMode = useStore((s) => s.settings.renderMode)
  const { setSky, setSettings, setStatus } = useStore.getState()

  const choose = (id: SkyPreset): void => {
    // Night dims the sun and fill so placed lights do the work; leaving night brings daylight back.
    const before = useStore.getState().sky.preset
    setSky({ preset: id })
    if (id === 'night') setSettings(NIGHT_LIGHTING)
    else if (before === 'night') setSettings(DAY_LIGHTING)
    const elevation = PRESET_SUN[id]
    if (elevation !== undefined) {
      const aim = sunInView(viewport.camera)
      setSettings({
        sunElevation: elevation,
        ...(aim && id !== 'clear' && id !== 'overcast' ? { sunAzimuth: aim.sunAzimuth } : {})
      })
    }
  }

  const file = useRef<HTMLInputElement>(null)
  const upload = async (f: File): Promise<void> => {
    // Browsers report no type for .hdr/.exr, and the sky loader picks its decoder from the type.
    const ext = f.name.toLowerCase().split('.').pop() ?? ''
    const mime = SKY_TYPES[ext] ?? 'image/jpeg'
    const media = registerMedia(f.name, mime, new Uint8Array(await f.arrayBuffer()))
    setSky({ preset: 'hdri', hdriMediaId: media.id, hdriName: f.name })
    setStatus(`Sky: ${f.name}`)
  }

  return (
    <div className="tab-body">
      <div className="sky-grid">
        {PRESETS.map((p) => (
          <button
            key={p.id}
            className={`sky-card ${sky.preset === p.id ? 'active' : ''}`}
            title={p.hint}
            onClick={() => choose(p.id)}
          >
            <span className="sky-swatch" style={{ background: p.swatch }} />
            <span>{p.label}</span>
          </button>
        ))}
        <button
          className={`sky-card ${sky.preset === 'hdri' ? 'active' : ''}`}
          onClick={() => file.current?.click()}
          title="Use your own .hdr, .exr, .jpg or .png panorama"
        >
          <span className="sky-swatch upload">
            <Upload size={18} />
          </span>
          <span>{sky.preset === 'hdri' && sky.hdriName ? sky.hdriName : 'Your own HDRI…'}</span>
        </button>
        <input
          ref={file}
          type="file"
          accept=".hdr,.exr,.jpg,.jpeg,.png,.webp"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0]
            e.target.value = ''
            if (f) void upload(f)
          }}
        />
      </div>

      {sky.preset === 'color' && (
        <label className="field">
          <span>Colour</span>
          <input type="color" value={sky.color} onChange={(e) => setSky({ color: e.target.value })} />
        </label>
      )}

      {sky.preset === 'hdri' && (
        <>
          <label className="field slider">
            <span>Rotate</span>
            <input
              type="range"
              min={-180}
              max={180}
              value={sky.rotation}
              onChange={(e) => setSky({ rotation: Number(e.target.value) })}
            />
            <em>{sky.rotation}°</em>
          </label>
          <label className="check">
            <input type="checkbox" checked={sky.lighting} onChange={(e) => setSky({ lighting: e.target.checked })} />
            <span>Light the scene with this sky{renderMode === 'vanilla' ? ' (switch Render to Cinematic)' : ''}</span>
          </label>
        </>
      )}

      {sky.preset !== 'biome' && sky.preset !== 'color' && sky.preset !== 'nether' && (
        <label className="field slider">
          <span>Brightness</span>
          <input
            type="range"
            min={0.2}
            max={2}
            step={0.05}
            value={sky.intensity}
            onChange={(e) => setSky({ intensity: Number(e.target.value) })}
          />
          <em>{sky.intensity.toFixed(2)}</em>
        </label>
      )}

      <Hint label="About HDRI skies">
        HDRIs are 360° panoramas (equirectangular .hdr/.exr, or a 2:1 .jpg/.png). Free CC0 ones are on{' '}
        <a href="https://polyhaven.com/hdris" target="_blank" rel="noreferrer">
          Poly Haven
        </a>
        . The image is stored inside your project. The sun direction (Look tab) also aims the physical skies.
      </Hint>
    </div>
  )
}

const WEATHER: { id: WeatherType; label: string; icon: typeof Sun }[] = [
  { id: 'none', label: 'Clear', icon: Sun },
  { id: 'rain', label: 'Rain', icon: CloudRain },
  { id: 'snow', label: 'Snow', icon: Snowflake }
]

/** Rain or snow in 3D around the view, and lightning strikes placed where you're looking. */
export function WeatherControls(): ReactNode {
  const weather = useStore((s) => s.settings.weather)
  const density = useStore((s) => s.settings.weatherDensity)
  const wind = useStore((s) => s.settings.wind)
  const { setSettings, setSky, add } = useStore.getState()
  return (
    <>
      <h4 className="section-label">Weather</h4>
      <div className="segmented">
        {WEATHER.map((w) => (
          <button
            key={w.id}
            className={weather === w.id ? 'active' : ''}
            onClick={() => {
              setSettings({ weather: w.id })
              // Rain looks wrong under a clear blue sky; start from the overcast one (easy to change back).
              if (w.id !== 'none' && ['biome', 'clear', 'golden'].includes(useStore.getState().sky.preset))
                setSky({ preset: 'overcast' })
            }}
          >
            <w.icon size={14} /> {w.label}
          </button>
        ))}
      </div>
      {weather !== 'none' && (
        <>
          <label className="field slider">
            <span>Amount</span>
            <input
              type="range"
              min={0.1}
              max={1}
              step={0.05}
              value={density}
              onChange={(e) => setSettings({ weatherDensity: Number(e.target.value) })}
            />
            <em>{Math.round(density * 100)}%</em>
          </label>
          <label className="field slider">
            <span>Wind</span>
            <input
              type="range"
              min={-1}
              max={1}
              step={0.05}
              value={wind}
              onChange={(e) => setSettings({ wind: Number(e.target.value) })}
            />
            <em>{wind.toFixed(2)}</em>
          </label>
        </>
      )}
      <button
        title="A vanilla lightning bolt striking where you're looking. Move it with the gizmo."
        onClick={() =>
          add({
            id: newId('obj'),
            kind: 'lightning',
            name: 'Lightning',
            seed: Math.floor(Math.random() * 2 ** 31),
            color: '#737380', // vanilla's (0.45, 0.45, 0.5)
            brightness: 1.5,
            flash: true,
            visible: true,
            ...placeNew('ground'),
            scale: 1
          })
        }
      >
        <Zap size={15} /> Add lightning strike
      </button>
      <Hint label="About weather">
        Rain and snow use the game's own textures and stop on roofs and trees. A lightning bolt is 128 blocks tall like
        in game; scale it down for a closer strike.
      </Hint>
    </>
  )
}
