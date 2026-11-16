// Builds the HTML for the README's section graphics (editor, features, install, first thumbnail, how it works,
// privacy). render.mjs turns each <section> into docs/images/readme/<id>.jpg. Icons are the app's own lucide set.
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const React = require('react')
const { renderToStaticMarkup } = require('react-dom/server')
const L = require('lucide-react')

const icon = (name, size = 20, stroke = 2) =>
  renderToStaticMarkup(React.createElement(L[name], { size, strokeWidth: stroke }))
const img = (f) => `../../docs/images/${f}`

// Layer tints from the app (green terrain, blue players, red mobs, yellow lights, pink text, purple media, orange FX).
const C = {
  green: '#4ade80',
  teal: '#2dd4bf',
  blue: '#60a5fa',
  red: '#f87171',
  yellow: '#facc15',
  pink: '#f472b6',
  purple: '#a78bfa',
  orange: '#fb923c',
  cyan: '#22d3ee'
}

const css = `
@font-face { font-family: Lilita; src: url('../../node_modules/@fontsource/lilita-one/files/lilita-one-latin-400-normal.woff2'); }
@font-face { font-family: Bungee; src: url('../../node_modules/@fontsource/bungee/files/bungee-latin-400-normal.woff2'); }
* { box-sizing: border-box; margin: 0; }
body { background: #0d1117; font-family: Inter, 'Noto Sans', 'DejaVu Sans', sans-serif; color: #e8eaee; }
section { position: relative; overflow: hidden; background: radial-gradient(ellipse 80% 120% at 0% 0%, #13241b 0%, #0d1117 55%), #0d1117; }
.grid { position: absolute; inset: 0; opacity: .07; pointer-events: none;
  background-image: linear-gradient(rgba(255,255,255,.7) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,.7) 1px, transparent 1px);
  background-size: 32px 32px; mask-image: linear-gradient(135deg, black, transparent 60%); }
.card { position: relative; background: linear-gradient(180deg, #171c24, #12161c); border: 1px solid #262b35; border-radius: 16px; overflow: hidden;
  box-shadow: 0 14px 30px rgba(0,0,0,.35); }
.ico { width: 44px; height: 44px; border-radius: 12px; display: grid; place-items: center; flex: none; }
.h { font-family: Lilita, sans-serif; font-weight: 400; letter-spacing: .3px; color: #f4f6f8; }
.p { color: #a3acb9; font-size: 15px; line-height: 1.45; }
.chip { display: inline-flex; align-items: center; gap: 6px; font-size: 13px; color: #d1fae5; padding: 5px 10px; border-radius: 999px;
  background: rgba(16, 40, 28, .8); border: 1px solid rgba(134, 239, 172, .3); }
.kbd { font: 600 12px Inter, sans-serif; color: #e8eaee; background: #232833; border: 1px solid #343b48; border-bottom-width: 2px; border-radius: 6px; padding: 2px 7px; }
.num { font-family: Bungee, sans-serif; font-size: 22px; width: 44px; height: 44px; border-radius: 12px; display: grid; place-items: center;
  color: #08200f; background: linear-gradient(180deg, #86efac, #22c55e); box-shadow: inset 0 -3px 0 rgba(0,0,0,.2); flex: none; }
`

const tint = (c) => `background: ${c}22; color: ${c}; box-shadow: inset 0 0 0 1px ${c}55;`

/* ---------- The editor, as v0.5.0 lays it out, with a real thumbnail in the canvas ---------- */
const rail = [
  ['Mountain', 'Biomes', true],
  ['Castle', 'Builds'],
  ['User', 'Players'],
  ['Box', 'Mobs'],
  ['Image', 'Media'],
  ['Type', 'Text'],
  ['Lightbulb', 'Lights'],
  ['CloudSun', 'Sky'],
  ['Flame', 'FX'],
  ['WandSparkles', 'Look']
]
const layers = [
  ['Lightbulb', 'Torch glow', C.yellow],
  ['Type', 'Text: VS', C.pink],
  ['User', 'Alex', C.blue],
  ['User', 'Steve', C.blue, true],
  ['Mountain', 'Dungeon (ready-made)', C.green]
]
const poses = [
  'Standing',
  'Walking',
  'Running',
  'Pointing',
  'Shocked',
  'Waving',
  'Sword swing',
  'Lunge',
  'Blocking',
  'Victory'
]
const editor = `
<section id="editor" style="width:1600px;height:900px;background:#0e1014;font-size:13px;">
  <div style="height:48px;display:flex;align-items:center;padding:0 14px;border-bottom:1px solid #262b35;gap:12px;">
    <img src="../../build/icon.png" style="width:22px;height:22px;border-radius:6px">
    <span style="font-weight:600;font-size:14px">Versus showdown</span><span style="color:#8c95a3">${icon('ChevronDown', 16)}</span>
    <div style="flex:1"></div>
    <span style="display:flex;align-items:center;gap:7px;color:#c9ced6;padding:7px 12px">${icon('MonitorPlay', 17)} Preview</span>
    <span style="display:flex;align-items:center;gap:8px;background:#4ade80;color:#08200f;font-weight:600;padding:8px 14px;border-radius:8px">${icon('Download', 17)} Export <span style="opacity:.6;border-left:1px solid #08200f55;padding-left:8px;display:flex">${icon('ChevronDown', 16)}</span></span>
  </div>
  <div style="display:flex;height:852px">
    <div style="width:64px;border-right:1px solid #1d2129;padding:8px 6px;display:flex;flex-direction:column;gap:4px">
      ${rail
        .map(
          ([i, t, on]) =>
            `<div style="display:flex;flex-direction:column;align-items:center;gap:3px;padding:8px 0;border-radius:10px;font-size:11px;${on ? 'background:#173124;color:#4ade80' : 'color:#8c95a3'}">${icon(i, 20, 1.75)}<span style="${on ? 'color:#e8eaee' : ''}">${t}</span></div>`
        )
        .join('')}
    </div>
    <div style="width:320px;background:#15181e;border-right:1px solid #262b35;padding:18px 16px">
      <div style="font-size:16px;font-weight:600">Biomes</div>
      <div style="color:#8c95a3;margin:12px 0 8px">Ready-made biomes · instant, swap any time</div>
      <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:6px">
        ${['Meadow', 'Dark forest', 'Snowy taiga', 'Desert', 'Desert island', 'Deep cave', 'Nether', 'Lava ravine', 'End island'].map((b) => `<div style="background:#1c2028;border-radius:6px;padding:9px 0;text-align:center">${b}</div>`).join('')}
      </div>
      <div style="display:flex;background:#101318;border-radius:8px;padding:3px;margin:22px 0 18px">
        ${['Overworld', 'Nether', 'The End'].map((d, i) => `<div style="flex:1;text-align:center;padding:7px 0;border-radius:6px;${i ? 'color:#8c95a3' : 'background:#232833'}">${d}</div>`).join('')}
      </div>
      ${[
        ['Seed', 'random'],
        ['Area', '48 × 48 blocks']
      ]
        .map(
          ([k, v]) =>
            `<div style="display:flex;align-items:center;margin-bottom:10px"><span style="width:84px;color:#c9ced6">${k}</span><span style="flex:1;background:#101318;border:1px solid #262b35;border-radius:6px;padding:8px 10px;color:${k === 'Seed' ? '#5f6775' : '#e8eaee'}">${v}</span></div>`
        )
        .join('')}
      <div style="display:flex;gap:10px;margin:16px 0;color:#c9ced6;line-height:1.4"><span style="width:30px;height:18px;border-radius:9px;background:#4ade80;flex:none;position:relative"><span style="position:absolute;right:2px;top:2px;width:14px;height:14px;border-radius:50%;background:#fff"></span></span><span>I agree to the <span style="color:#4ade80">Minecraft EULA</span> (needed to run the official world generator)</span></div>
      <div style="background:#e8eaee;color:#0e1014;font-weight:600;text-align:center;padding:10px;border-radius:8px">Generate Plains</div>
      <div style="display:flex;align-items:center;gap:6px;color:#5f6775;margin-top:14px">${icon('CircleHelp', 14)} How this works</div>
      <div style="border-top:1px solid #262b35;margin:18px -16px 0;padding:14px 16px;display:flex;gap:8px;align-items:center;font-weight:500">${icon('ChevronRight', 15)} Import from your own world</div>
    </div>
    <div style="flex:1;background:#0a0b0e;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:22px">
      <div style="width:832px;height:468px;border-radius:10px;background:url('${img('scene-2.jpg')}') center/cover;box-shadow:0 20px 50px rgba(0,0,0,.6)"></div>
      <div style="display:flex;align-items:center;gap:4px;background:#15181e;border:1px solid #262b35;border-radius:12px;padding:6px;color:#c9ced6;box-shadow:0 8px 24px rgba(0,0,0,.45)">
        ${[
          ['Move3d', 1],
          ['Rotate3d'],
          ['Scale3d'],
          '|',
          ['Undo2'],
          ['Redo2'],
          '|',
          ['Camera'],
          ['Clapperboard', 0, C.green],
          ['Scan'],
          '|',
          ['Grid3x3', 1],
          ['Magnet'],
          ['Ruler'],
          '|',
          ['Maximize2']
        ]
          .map((d) =>
            d === '|'
              ? '<span style="width:1px;height:22px;background:#2b313c;margin:0 4px"></span>'
              : `<span style="width:34px;height:34px;display:grid;place-items:center;border-radius:8px;${d[1] ? 'background:#232833;color:#e8eaee' : ''}${d[2] ? `color:${d[2]}` : ''}">${icon(d[0], 18)}</span>`
          )
          .join('')}
      </div>
    </div>
    <div style="width:310px;background:#15181e;border-left:1px solid #262b35;padding:14px 12px">
      <div style="display:flex;align-items:center;gap:6px;font-weight:600;padding:0 4px 8px">${icon('ChevronDown', 15)} Layers · 5</div>
      ${layers
        .map(
          ([i, t, c, sel]) =>
            `<div style="display:flex;align-items:center;gap:9px;padding:8px 10px;margin-bottom:3px;border-radius:6px;border-left:3px solid ${c};${sel ? 'background:#232833' : 'background:#181c23'}"><span style="color:${c};display:flex">${icon(i, 16)}</span>${t}</div>`
        )
        .join('')}
      <div style="border-top:1px solid #262b35;margin:14px -12px 0;padding:14px 16px 0">
        <div style="display:flex;align-items:center;gap:6px;font-weight:600;margin-bottom:12px">${icon('ChevronDown', 15)} Player</div>
        <div style="background:#101318;border:1px solid #262b35;border-radius:6px;padding:8px 10px;margin-bottom:6px">Steve</div>
        <div style="color:#5f6775;font-size:12px;margin-bottom:16px">Type a Minecraft username to wear that player's skin.</div>
        <div style="color:#c9ced6;margin-bottom:8px">Pose</div>
        <div style="display:flex;flex-wrap:wrap;gap:5px">${poses.map((p) => `<span style="padding:6px 9px;border-radius:6px;${p === 'Sword swing' ? 'background:#173124;color:#4ade80;box-shadow:inset 0 0 0 1px #4ade80' : 'background:#1c2028;color:#c9ced6'}">${p}</span>`).join('')}</div>
        ${[
          ['Name tag', 0],
          ['Slim arms (Alex model)', 0],
          ['Always on top', 0]
        ]
          .map(
            ([t]) =>
              `<div style="display:flex;justify-content:space-between;align-items:center;margin-top:16px">${t}<span style="width:30px;height:18px;border-radius:9px;background:#343b48;position:relative"><span style="position:absolute;left:2px;top:2px;width:14px;height:14px;border-radius:50%;background:#c9ced6"></span></span></div>`
          )
          .join('')}
      </div>
    </div>
  </div>
</section>`

/* ---------- What is it: three pillars ---------- */
const pillars = [
  [
    'Mountain',
    C.green,
    'It is the real game',
    'Terrain comes from Mojang’s own world generator. Blocks, mobs and textures come from the Minecraft you play.',
    'scene-1.jpg',
    '50% 60%'
  ],
  [
    'Type',
    C.pink,
    'Built for thumbnails',
    'Outlined titles, dramatic lighting, posable players, smoke and fire. Exports fit YouTube’s size and 2 MB limit.',
    'preview-manhunt.jpg',
    '50% 30%'
  ],
  [
    'Zap',
    C.yellow,
    'Done in minutes',
    'Pick a ready-made scene, type your username, change the text and export. No Photoshop needed.',
    'scene-0.jpg',
    '50% 50%'
  ]
]
const what = `
<section id="pillars" style="width:1280px;padding:28px;"><div class="grid"></div>
  <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:20px;position:relative">
    ${pillars
      .map(
        ([
          i,
          c,
          t,
          d,
          im,
          pos
        ]) => `<div class="card"><div style="height:170px;background:url('${img(im)}') ${pos}/cover;mask-image:linear-gradient(180deg,#000 55%,transparent)"></div>
        <div style="padding:0 22px 24px;margin-top:-26px;position:relative"><div class="ico" style="${tint(c)};background:#12161c">${icon(i, 22)}</div>
        <div class="h" style="font-size:27px;margin:14px 0 8px">${t}</div><div class="p">${d}</div></div></div>`
      )
      .join('')}
  </div>
</section>`

/* ---------- Features: twelve cards ---------- */
const feats = [
  [
    'Mountain',
    C.green,
    'Real terrain',
    'Any biome in all three dimensions, made by Minecraft itself, or cut from your own worlds.'
  ],
  ['User', C.blue, 'Players', 'Any username’s skin, posable down to elbows and knees, with armour and items.'],
  ['Box', C.red, 'Mobs', 'Every mob in your game version, with texture variants and per-limb posing.'],
  ['Castle', C.teal, 'Builds', 'Every vanilla structure plus quick props. Imports .schem, .litematic and .nbt.'],
  ['Flame', C.orange, 'FX', 'Smoke, fog, fire, explosions, lightning, light beams, sparkle and weather.'],
  ['Lightbulb', C.yellow, 'Lighting', 'Four render modes, coloured lights, bloom, god rays and a movable sun.'],
  ['Palette', C.purple, 'Colour looks', 'Film-style 3D LUTs, plus your own .cube files from Resolve or Premiere.'],
  ['Focus', C.cyan, 'Focus & lens', 'Drag-to-focus blur, lens warp, grain, light leaks, paper cutout and CRT.'],
  ['Type', C.pink, 'Titles', 'Outlined text with glow, 3D Minecraft font, stone titles and Hardcore hearts.'],
  ['Shapes', C.pink, 'Thumbnail kit', 'Arrows, circles, crosses, bursts and boxes in any colour, with glow.'],
  [
    'Columns2',
    C.purple,
    'Tabs & split',
    'Several projects at once, variants in one click, and “Day 1 vs Day 100” splits.'
  ],
  ['MonitorPlay', C.red, 'YouTube preview', 'See it in the home feed, search and on a phone before you upload.']
]
const features = `
<section id="features" style="width:1280px;padding:28px;"><div class="grid"></div>
  <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:16px;position:relative">
    ${feats
      .map(
        ([i, c, t, d]) => `<div class="card" style="padding:20px 20px 22px;border-top:2px solid ${c}">
        <div style="display:flex;align-items:center;gap:12px;margin-bottom:12px"><div class="ico" style="${tint(c)}">${icon(i, 22)}</div><div class="h" style="font-size:24px">${t}</div></div>
        <div class="p" style="font-size:14.5px">${d}</div></div>`
      )
      .join('')}
  </div>
</section>`

/* ---------- Install: three steps ---------- */
const install = `
<section id="install" style="width:1280px;padding:28px;"><div class="grid"></div>
  <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:20px;position:relative">
    <div class="card" style="padding:24px">
      <div style="display:flex;align-items:center;gap:14px"><div class="num">1</div><div class="h" style="font-size:28px">Download</div></div>
      <div class="p" style="margin:14px 0 18px">Grab the latest version from the Releases page.</div>
      <div style="display:flex;flex-direction:column;gap:10px">
        <div style="display:flex;align-items:center;gap:12px;background:#101318;border:1px solid #262b35;border-radius:10px;padding:12px 14px"><span style="color:${C.blue};display:flex">${icon('Monitor', 22)}</span><div><div style="font-weight:600">Windows 10 / 11</div><div class="p" style="font-size:13px">Setup .exe (auto-updates) or portable .exe</div></div></div>
        <div style="display:flex;align-items:center;gap:12px;background:#101318;border:1px solid #262b35;border-radius:10px;padding:12px 14px"><span style="color:#d1d5db;display:flex">${icon('Laptop', 22)}</span><div><div style="font-weight:600">macOS 12+</div><div class="p" style="font-size:13px">One .dmg for Intel and Apple Silicon</div></div></div>
      </div>
    </div>
    <div class="card" style="padding:24px">
      <div style="display:flex;align-items:center;gap:14px"><div class="num">2</div><div class="h" style="font-size:28px">Open it</div></div>
      <div class="p" style="margin:14px 0 18px">The first launch asks once, because the app isn’t code-signed yet.</div>
      <div style="display:flex;flex-direction:column;gap:10px">
        <div style="background:#101318;border:1px solid #262b35;border-radius:10px;padding:12px 14px"><div style="font-weight:600;margin-bottom:8px">Windows SmartScreen</div><span class="kbd">More info</span> <span style="color:#5f6775">→</span> <span class="kbd">Run anyway</span></div>
        <div style="background:#101318;border:1px solid #262b35;border-radius:10px;padding:12px 14px"><div style="font-weight:600;margin-bottom:8px">macOS</div><span class="kbd">Privacy &amp; Security</span> <span style="color:#5f6775">→</span> <span class="kbd">Open Anyway</span></div>
      </div>
    </div>
    <div class="card" style="padding:24px">
      <div style="display:flex;align-items:center;gap:14px"><div class="num">3</div><div class="h" style="font-size:28px">Start creating</div></div>
      <div class="p" style="margin:14px 0 18px">ThumbCraft finds your Minecraft by itself, whichever launcher you use.</div>
      <div style="display:flex;flex-wrap:wrap;gap:8px">${['Official launcher', 'Prism', 'Modrinth', 'CurseForge'].map((l) => `<span class="chip">${icon('Check', 14)} ${l}</span>`).join('')}</div>
      <div style="margin-top:18px;display:flex;gap:10px;align-items:flex-start;background:#173124;border:1px solid #2a5a3c;border-radius:10px;padding:12px 14px;color:#bbf7d0;font-size:14px;line-height:1.4"><span style="display:flex;color:#4ade80">${icon('Sparkles', 18)}</span>No Minecraft found? It downloads the game files from Mojang, and Java with one click.</div>
    </div>
  </div>
</section>`

/* ---------- Your first thumbnail: five steps ---------- */
const steps = [
  ['Pick a scene', 'Start from a ready-made scene or an empty biome.', 'background:#0a0b0e', false, false, true],
  [
    'Make it yours',
    'Click the player, type your username, edit the text.',
    `background:url('${img('scene-2.jpg')}') center/cover`
  ],
  [
    'Frame it',
    'Orbit, pan and zoom. Shift snaps things onto surfaces.',
    `background:url('${img('scene-1.jpg')}') center/cover`,
    true
  ],
  [
    'Add drama',
    'FX, lights and a colour look from the side panels.',
    `background:url('${img('looks-comparison.jpg')}') 0 100%/207% auto`
  ],
  [
    'Export',
    'A YouTube-ready JPG, under the 2 MB limit.',
    `background:url('${img('preview-manhunt.jpg')}') center/cover`,
    false,
    true
  ]
]
const first = `
<section id="first-thumbnail" style="width:1600px;padding:28px;"><div class="grid"></div>
  <div style="display:grid;grid-template-columns:repeat(5,1fr);gap:16px;position:relative">
    ${steps
      .map(
        ([t, d, bg, frame, exp, pick], n) => `<div class="card">
        <div style="height:158px;position:relative;${bg}">
          ${pick ? `<div style="position:absolute;inset:12px;display:grid;grid-template-columns:1fr 1fr;gap:8px">${['scene-0.jpg', 'scene-1.jpg', 'scene-2.jpg', 'preview-day1.jpg'].map((f, i) => `<div style="border-radius:6px;background:url('${img(f)}') center/cover;${i === 0 ? 'box-shadow:0 0 0 2px #4ade80' : 'opacity:.75'}"></div>`).join('')}</div>` : ''}
          ${frame ? `<div style="position:absolute;inset:16px 22px;border:2px dashed rgba(255,255,255,.85);border-radius:6px"></div><div style="position:absolute;right:10px;bottom:10px;color:#fff;background:rgba(0,0,0,.6);border-radius:8px;padding:6px;display:flex">${icon('Rotate3d', 20)}</div>` : ''}
          ${exp ? `<div style="position:absolute;right:8px;bottom:8px;font:600 12px Inter;background:#4ade80;color:#08200f;padding:4px 8px;border-radius:6px;display:flex;gap:5px;align-items:center">${icon('Download', 13)} 1.4 MB · JPG</div>` : ''}
        </div>
        <div style="padding:16px 18px 20px"><div style="display:flex;align-items:center;gap:10px"><div class="num" style="width:34px;height:34px;font-size:17px;border-radius:9px">${n + 1}</div><div class="h" style="font-size:22px">${t}</div></div>
        <div class="p" style="font-size:14px;margin-top:10px">${d}</div></div></div>`
      )
      .join('')}
  </div>
</section>`

/* ---------- How it works ---------- */
const src = (i, c, t, d) =>
  `<div class="card" style="display:flex;gap:14px;align-items:center;padding:16px 18px"><div class="ico" style="${tint(c)}">${icon(i, 22)}</div><div><div style="font-weight:600;font-size:16px">${t}</div><div class="p" style="font-size:13.5px">${d}</div></div></div>`
const arrow = `<svg width="70" height="24" viewBox="0 0 70 24"><path d="M2 12h60" stroke="#4ade80" stroke-width="2.5" stroke-dasharray="6 5"/><path d="M58 5l9 7-9 7" fill="none" stroke="#4ade80" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`
const how = `
<section id="how-it-works" style="width:1280px;padding:32px 28px;"><div class="grid"></div>
  <div style="display:flex;align-items:center;gap:14px;position:relative">
    <div style="display:flex;flex-direction:column;gap:12px;width:380px">
      ${src('HardDrive', C.green, 'Your Minecraft install', 'Textures, models and structures')}
      ${src('Cpu', C.orange, 'Mojang’s world generator', 'Runs on your PC for real terrain')}
      ${src('CloudDownload', C.blue, 'Mojang’s skin server', 'Skins for the usernames you type')}
    </div>
    ${arrow}
    <div class="card" style="width:290px;padding:26px 22px;text-align:center;border-color:#2a5a3c;box-shadow:0 0 50px rgba(74,222,128,.15)">
      <img src="../../build/icon.png" style="width:72px;height:72px;border-radius:18px">
      <div class="h" style="font-family:Bungee;font-size:26px;color:#86efac;margin:12px 0 6px">THUMBCRAFT</div>
      <div class="p" style="font-size:14px">3D scene editor that resolves blocks and mobs exactly as the game does</div>
    </div>
    ${arrow}
    <div style="flex:1">
      <div style="border-radius:12px;overflow:hidden;aspect-ratio:16/9;background:url('${img('preview-100days.jpg')}') center/cover;box-shadow:0 0 0 3px #fff,0 18px 40px rgba(0,0,0,.6)"></div>
      <div style="text-align:center;margin-top:12px;font-weight:600">JPG / PNG thumbnail</div>
    </div>
  </div>
</section>`

/* ---------- Privacy ---------- */
const priv = [
  ['EyeOff', C.purple, 'No tracking', 'No accounts and no telemetry. Your projects never leave your PC.'],
  [
    'BadgeCheck',
    C.green,
    'Verified downloads',
    'Game files are checked against Mojang’s SHA&#8209;1 and Java against Adoptium’s SHA&#8209;256.'
  ],
  [
    'ShieldCheck',
    C.blue,
    'Safe to open',
    'Projects run sandboxed and can’t load files from your disk or open web pages.'
  ]
]
const privacy = `
<section id="privacy" style="width:1280px;padding:28px;"><div class="grid"></div>
  <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:20px;position:relative">
    ${priv.map(([i, c, t, d]) => `<div class="card" style="padding:22px;display:flex;gap:16px"><div class="ico" style="${tint(c)}">${icon(i, 22)}</div><div><div class="h" style="font-size:24px;margin-bottom:6px">${t}</div><div class="p" style="font-size:14.5px">${d}</div></div></div>`).join('')}
  </div>
</section>`

export const sections = ['editor', 'pillars', 'features', 'install', 'first-thumbnail', 'how-it-works', 'privacy']
export const html = `<!doctype html><html><head><meta charset="utf-8"><style>${css}</style></head><body>${editor}${what}${features}${install}${first}${how}${privacy}</body></html>`
