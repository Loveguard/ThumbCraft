// Renders the README images from the HTML files next to this script: `node tools/banner/render.mjs`.
// Needs Playwright with a Chromium (npx playwright install chromium) and the fonts from `npm install`.
import { chromium } from 'playwright'
import { fileURLToPath } from 'node:url'

const here = (f) => fileURLToPath(new URL(f, import.meta.url))
const only = process.argv.slice(2)
const pages = [
  ['banner.html', 1280, 400, '../../docs/images/banner.jpg'],
  ['social.html', 1280, 640, '../../docs/images/social-preview.jpg'],
  ['looks.html', 1600, 300, '../../docs/images/looks.jpg']
]

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH })
for (const [html, width, height, out] of pages.filter(([h]) => !only.length || only.includes(h))) {
  const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 2 })
  await page.goto('file://' + here(html))
  await page.evaluate(() => document.fonts.ready)
  await page.screenshot({ path: here(out), type: 'jpeg', quality: 88 })
  await page.close()
  console.log('wrote', out)
}
await browser.close()
