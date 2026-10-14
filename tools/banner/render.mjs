// Renders the README images: `node tools/banner/render.mjs [name…]` (names: banner.html, social.html, looks.html, or a
// section id from readme-art.mjs such as features, or support.html). Needs Playwright with a Chromium and the fonts from `npm install`.
import { chromium } from 'playwright'
import { writeFileSync, rmSync, mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { html, sections } from './readme-art.mjs'

const here = (f) => fileURLToPath(new URL(f, import.meta.url))
const only = process.argv.slice(2)
const want = (name) => !only.length || only.includes(name)
const pages = [
  ['banner.html', 1280, 400, '../../docs/images/banner.jpg'],
  ['social.html', 1280, 640, '../../docs/images/social-preview.jpg'],
  ['looks.html', 1600, 300, '../../docs/images/looks.jpg']
]

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH })
for (const [file, width, height, out] of pages.filter(([f]) => want(f))) {
  const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 2 })
  await page.goto('file://' + here(file))
  await page.evaluate(() => document.fonts.ready)
  await page.screenshot({ path: here(out), type: 'jpeg', quality: 88 })
  await page.close()
  console.log('wrote', out)
}

// The section graphics live in one generated page, one <section> per image.
const art = here('.readme-art.html')
writeFileSync(art, html)
mkdirSync(here('../../docs/images/readme'), { recursive: true })
const page = await browser.newPage({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 2 })
await page.goto('file://' + art)
await page.evaluate(() => document.fonts.ready)
for (const id of sections.filter(want)) {
  const out = id === 'editor' ? '../../docs/images/editor.jpg' : `../../docs/images/readme/${id}.jpg`
  await page.locator('#' + id).screenshot({ path: here(out), type: 'jpeg', quality: 86 })
  console.log('wrote', out)
}
rmSync(art)

// The support button is a transparent PNG cropped to the button itself.
if (want('support.html')) {
  const page = await browser.newPage({ viewport: { width: 600, height: 120 }, deviceScaleFactor: 2 })
  await page.goto('file://' + here('support.html'))
  await page.evaluate(() => document.fonts.ready)
  const box = await page.locator('#support').boundingBox()
  const clip = { x: box.x - 4, y: box.y - 2, width: box.width + 8, height: box.height + 10 }
  await page.screenshot({ path: here('../../docs/images/support.png'), clip, omitBackground: true })
  await page.close()
  console.log('wrote ../../docs/images/support.png')
}
await browser.close()
