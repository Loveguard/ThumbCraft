// Lets Claude (or any MCP client) work inside the running app: a Model Context Protocol server on this computer
// only (127.0.0.1), guarded by a random key. Each tool call is handed to the window, which edits the scene the
// same way the panels do (see renderer/src/claudeBridge.ts), so everything Claude does shows on screen, can be
// undone, and is saved with the project.
//
// Clients connect either straight over HTTP (Claude Code: `claude mcp add --transport http …`) or through the
// small stdio launcher in mcp/thumbcraft-mcp.cjs (Claude Desktop), which reads the address and key from
// claude-bridge.json in the app's data folder.
import { app, BrowserWindow, ipcMain } from 'electron'
import { randomBytes, timingSafeEqual } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { basename, dirname, extname, isAbsolute, join } from 'node:path'
import { CLAUDE_TOOLS, type ClaudeTool } from '@shared/claudeTools'
import { writeAtomic } from './projects'
import { readSettings } from './settings'

const DEFAULT_PORT = 47821
const PROTOCOL_VERSIONS = ['2025-06-18', '2025-03-26', '2024-11-05']
const MAX_BODY = 8 * 2 ** 20

let server: Server | null = null
let key = ''
let getWindow: () => BrowserWindow | null = () => null

/** Where the launcher (and anyone set up by hand) finds the server. */
export const bridgeFile = (): string => join(app.getPath('userData'), 'claude-bridge.json')

// ------------------------------------------------------------------ window round trip

let nextId = 1
const waiting = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void; timer: NodeJS.Timeout }>()

function askWindow(method: string, params: unknown, timeoutMs: number): Promise<unknown> {
  const win = getWindow()
  if (!win || win.isDestroyed()) return Promise.reject(new Error('The ThumbCraft window is not open'))
  const id = nextId++
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      waiting.delete(id)
      reject(new Error(`ThumbCraft took longer than ${Math.round(timeoutMs / 1000)} s to do "${method}"`))
    }, timeoutMs)
    waiting.set(id, { resolve, reject, timer })
    win.webContents.send('claude:request', { id, method, params })
  })
}

ipcMain.on('claude:response', (_e, r: { id: number; ok: boolean; result?: unknown; error?: string }) => {
  const w = waiting.get(r?.id)
  if (!w) return
  waiting.delete(r.id)
  clearTimeout(w.timer)
  if (r.ok) w.resolve(r.result)
  else w.reject(new Error(r.error || 'Something went wrong in ThumbCraft'))
})

// ------------------------------------------------------------------ files Claude asks for

const PICTURES = (): string => join(app.getPath('pictures'), 'ThumbCraft')
const ALLOWED_EXT = new Set(['.png', '.jpg', '.jpeg', '.psd', '.mp4', '.webm', '.gif', '.zip', '.bfproj', '.glb'])

/** A file Claude asked to write: an absolute path, or a name inside Pictures/ThumbCraft. Only known file types. */
function outputPath(wanted: unknown, fallbackName: string, ext: string): string {
  let path = typeof wanted === 'string' && wanted.trim() ? wanted.trim() : fallbackName
  if (!isAbsolute(path)) path = join(PICTURES(), path)
  if (!extname(path)) path += ext
  if (!ALLOWED_EXT.has(extname(path).toLowerCase()))
    throw new Error(`ThumbCraft only writes ${[...ALLOWED_EXT].join(', ')} files`)
  mkdirSync(dirname(path), { recursive: true })
  return path
}

const safeName = (s: unknown): string =>
  String(s || 'thumbnail')
    .replace(/[<>:"/\\|?*\x00-\x1f]+/g, ' ')
    .trim()
    .slice(0, 80) || 'thumbnail'

interface FileResult {
  /** base64 bytes to write, with the extension they want. */
  file?: { base64: string; ext: string; name: string }
  [k: string]: unknown
}

// ------------------------------------------------------------------ tools

type Content = { type: 'text'; text: string } | { type: 'image'; data: string; mimeType: string }

async function callTool(tool: ClaudeTool, args: Record<string, unknown>): Promise<Content[]> {
  // A file type ThumbCraft won't write is refused before anything is rendered.
  if (typeof args.path === 'string' && extname(args.path) && !ALLOWED_EXT.has(extname(args.path).toLowerCase()))
    throw new Error(`ThumbCraft only writes ${[...ALLOWED_EXT].join(', ')} files`)
  // Pictures from this computer are read here (the window has no file access) and handed over as bytes.
  if (tool.name === 'add_image' && typeof args.file === 'string') {
    const ext = extname(args.file).toLowerCase()
    const mime = {
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.webp': 'image/webp',
      '.gif': 'image/gif'
    }[ext]
    if (!mime) throw new Error('file must be a .png, .jpg, .webp or .gif picture')
    const bytes = readFileSync(args.file)
    if (bytes.length > 64 * 2 ** 20) throw new Error('That picture is over 64 MB')
    args = { ...args, file: undefined, data: bytes.toString('base64'), mime, name: args.name ?? basename(args.file) }
  }
  const result = (await askWindow(tool.name, args, tool.slow ? 15 * 60_000 : 90_000)) as FileResult | null
  const content: Content[] = []
  if (result && typeof result === 'object') {
    const { image, file, ...rest } = result as FileResult & { image?: { base64: string; mimeType: string } }
    if (file) {
      const path = outputPath(args.path, safeName(file.name), file.ext)
      const bytes = Buffer.from(file.base64, 'base64')
      if (file.ext === '.bfproj') writeAtomic(path, bytes)
      else writeFileSync(path, bytes)
      rest.savedTo = path
    }
    if (image) content.push({ type: 'image', data: image.base64, mimeType: image.mimeType })
    if (Object.keys(rest).length) content.unshift({ type: 'text', text: JSON.stringify(rest) })
  } else if (result !== undefined) content.push({ type: 'text', text: JSON.stringify(result) })
  if (!content.length) content.push({ type: 'text', text: 'Done.' })
  return content
}

// ------------------------------------------------------------------ MCP over HTTP (JSON-RPC 2.0)

interface RpcRequest {
  jsonrpc: '2.0'
  id?: string | number | null
  method: string
  params?: Record<string, unknown>
}

const INSTRUCTIONS = [
  'These tools control the ThumbCraft window that is open on this computer: a Minecraft thumbnail studio.',
  'Start with get_scene (what is in the picture, with object ids) and get_options (valid ids for poses, looks,',
  'biomes, templates, mobs, animation blocks). Use screenshot to look at the result after changes; check your',
  'work visually before saying it is finished. Positions are in blocks (y up, the ground is usually y=0),',
  'rotations in degrees, yaw = rotation[1]. Everything you do can be undone with undo.'
].join(' ')

const toolList = (): unknown[] =>
  CLAUDE_TOOLS.map((t) => ({
    name: t.name,
    title: t.title,
    description: t.description,
    inputSchema: t.inputSchema,
    annotations: { readOnlyHint: !!t.readOnly, destructiveHint: !!t.destructive, openWorldHint: false }
  }))

async function handleRpc(msg: RpcRequest): Promise<unknown | undefined> {
  const reply = (result: unknown): unknown => ({ jsonrpc: '2.0', id: msg.id ?? null, result })
  const fail = (code: number, message: string): unknown => ({
    jsonrpc: '2.0',
    id: msg.id ?? null,
    error: { code, message }
  })
  if (msg.id === undefined || msg.id === null) return undefined // a notification: nothing to answer
  switch (msg.method) {
    case 'initialize': {
      const asked = String(msg.params?.protocolVersion ?? '')
      return reply({
        protocolVersion: PROTOCOL_VERSIONS.includes(asked) ? asked : PROTOCOL_VERSIONS[0],
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: 'thumbcraft', title: 'ThumbCraft', version: app.getVersion() },
        instructions: INSTRUCTIONS
      })
    }
    case 'ping':
      return reply({})
    case 'tools/list':
      return reply({ tools: toolList() })
    case 'tools/call': {
      const name = String(msg.params?.name ?? '')
      const tool = CLAUDE_TOOLS.find((t) => t.name === name)
      if (!tool) return fail(-32602, `Unknown tool: ${name}`)
      const args = (msg.params?.arguments ?? {}) as Record<string, unknown>
      try {
        return reply({ content: await callTool(tool, args) })
      } catch (e) {
        return reply({ content: [{ type: 'text', text: e instanceof Error ? e.message : String(e) }], isError: true })
      }
    }
    default:
      return fail(-32601, `Method not found: ${msg.method}`)
  }
}

function authorised(req: IncomingMessage): boolean {
  const given = Buffer.from(String(req.headers.authorization ?? '').replace(/^Bearer\s+/i, ''))
  const want = Buffer.from(key)
  return given.length === want.length && timingSafeEqual(given, want)
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let size = 0
    req.on('data', (c: Buffer) => {
      size += c.length
      if (size > MAX_BODY) {
        reject(new Error('Request too large'))
        req.destroy()
      } else chunks.push(c)
    })
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}

async function handleHttp(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const send = (status: number, body?: unknown): void => {
    res.writeHead(status, body === undefined ? {} : { 'content-type': 'application/json' })
    res.end(body === undefined ? undefined : JSON.stringify(body))
  }
  // Web pages can reach localhost too; a page has an Origin, the MCP clients don't.
  if (req.headers.origin) return send(403, { error: 'Browsers may not use this server' })
  const path = (req.url ?? '/').split('?')[0]
  if (path !== '/mcp') return send(404, { error: 'Not found' })
  if (!authorised(req)) return send(401, { error: 'Missing or wrong key (see claude-bridge.json)' })
  if (req.method === 'GET') return send(405) // no server-sent stream; every answer comes back with its request
  if (req.method === 'DELETE') return send(200, {})
  if (req.method !== 'POST') return send(405)
  let parsed: unknown
  try {
    parsed = JSON.parse(await readBody(req))
  } catch {
    return send(400, { jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } })
  }
  const batch = Array.isArray(parsed)
  const messages = (batch ? parsed : [parsed]) as RpcRequest[]
  const answers = (await Promise.all(messages.map((m) => handleRpc(m)))).filter((a) => a !== undefined)
  if (!answers.length) return send(202)
  send(200, batch ? answers : answers[0])
}

/** Starts the server (unless turned off with "claudeBridge": false in settings.json) and writes where it is. */
export function startClaudeBridge(windowOf: () => BrowserWindow | null): void {
  getWindow = windowOf
  if (readSettings().claudeBridge === false || server) return
  // The key stays the same from one start to the next, so a client set up once keeps working.
  try {
    const old = existsSync(bridgeFile()) ? JSON.parse(readFileSync(bridgeFile(), 'utf8')) : null
    if (typeof old?.key === 'string' && old.key.length >= 24) key = old.key
  } catch {
    // unreadable: make a new one
  }
  key ||= randomBytes(24).toString('base64url')
  const tryPort = (port: number, attemptsLeft: number): void => {
    const s = createServer((req, res) => {
      handleHttp(req, res).catch((e) => {
        if (!res.headersSent) res.writeHead(500, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }))
      })
    })
    s.once('error', (e: NodeJS.ErrnoException) => {
      // Another ThumbCraft (or something else) has the port: take the next one.
      if (e.code === 'EADDRINUSE' && attemptsLeft > 0) tryPort(port + 1, attemptsLeft - 1)
      else console.error('Claude bridge could not start:', e)
    })
    s.listen(port, '127.0.0.1', () => {
      server = s
      const info = { url: `http://127.0.0.1:${port}/mcp`, key, pid: process.pid, version: app.getVersion() }
      try {
        writeAtomic(bridgeFile(), new TextEncoder().encode(JSON.stringify(info, null, 2)))
        // The launcher lists these even while the app is closed, so clients that only read the list once see them.
        writeAtomic(
          join(app.getPath('userData'), 'claude-tools.json'),
          new TextEncoder().encode(JSON.stringify({ tools: toolList() }))
        )
      } catch (e) {
        console.error('Could not write claude-bridge.json:', e)
      }
    })
  }
  tryPort(DEFAULT_PORT, 10)
}

export function stopClaudeBridge(): void {
  server?.close()
  server = null
  for (const w of waiting.values()) {
    clearTimeout(w.timer)
    w.reject(new Error('ThumbCraft is closing'))
  }
  waiting.clear()
}
