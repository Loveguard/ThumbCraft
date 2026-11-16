#!/usr/bin/env node
// ThumbCraft MCP launcher: lets Claude Desktop (or any MCP client that starts servers over stdio) talk to the
// ThumbCraft window that is open on this computer. It passes messages to the app's own server on 127.0.0.1,
// whose address and key the app writes to claude-bridge.json in its data folder.
//
// No packages needed; Node 18 or newer. Setup steps: mcp/README.md.
'use strict'
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const readline = require('node:readline')

const DATA_NAMES = ['ThumbCraft', 'ThumbCrafter', 'BlockFrame']
const PROTOCOL = '2025-06-18'

function dataDirs() {
  const home = os.homedir()
  const roots =
    process.platform === 'win32'
      ? [process.env.APPDATA || path.join(home, 'AppData', 'Roaming')]
      : process.platform === 'darwin'
        ? [path.join(home, 'Library', 'Application Support')]
        : [process.env.XDG_CONFIG_HOME || path.join(home, '.config')]
  return roots.flatMap((r) => DATA_NAMES.map((n) => path.join(r, n)))
}

/** The running app's address and key, or null when ThumbCraft isn't open (or is too old to have the bridge). */
function bridge() {
  const files = process.env.THUMBCRAFT_BRIDGE
    ? [process.env.THUMBCRAFT_BRIDGE]
    : dataDirs().map((d) => path.join(d, 'claude-bridge.json'))
  for (const f of files) {
    try {
      const b = JSON.parse(fs.readFileSync(f, 'utf8'))
      if (b && b.url && b.key) return b
    } catch {
      // not there
    }
  }
  return null
}

let lastError = ''
async function post(message) {
  try {
    return await postOnce(message)
  } catch (e) {
    lastError = e && e.message ? e.message + (e.cause ? ` (${e.cause.code || e.cause.message})` : '') : String(e)
    throw e
  }
}

async function postOnce(message) {
  if (typeof fetch !== 'function')
    throw new Error(`Node ${process.version} is too old; ThumbCraft's launcher needs Node 18+`)
  const b = bridge()
  if (!b) throw new Error(`no claude-bridge.json in ${dataDirs().join(' or ')}`)
  const res = await fetch(b.url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      authorization: `Bearer ${b.key}`
    },
    body: JSON.stringify(message)
  })
  if (res.status === 202) return null
  if (!res.ok) throw new Error(`ThumbCraft answered ${res.status}`)
  return res.json()
}

const send = (m) => process.stdout.write(JSON.stringify(m) + '\n')
const NOT_RUNNING =
  'ThumbCraft is not open (or is an older version without the Claude bridge). Ask the user to start it ' +
  '(npm run dev in the ThumbCraft folder, or the installed app), then try again.'

// While the app is closed only this tool is listed; once it opens, the client is told the list changed.
const WAITING_TOOL = {
  name: 'thumbcraft_status',
  title: 'Is ThumbCraft open?',
  description: 'Checks whether the ThumbCraft app is open. Its other tools appear once it is.',
  inputSchema: { type: 'object', properties: {}, additionalProperties: false }
}
/** The tool list the app saved the last time it ran, so the tools are known before it is opened. */
function savedTools() {
  for (const d of dataDirs()) {
    try {
      const t = JSON.parse(fs.readFileSync(path.join(d, 'claude-tools.json'), 'utf8')).tools
      if (Array.isArray(t)) return t
    } catch {
      // not there
    }
  }
  return []
}
let listedWhileClosed = false
let watcher = null
function watchForApp() {
  if (watcher) return
  watcher = setInterval(async () => {
    try {
      await post({ jsonrpc: '2.0', id: 'probe', method: 'ping' })
      clearInterval(watcher)
      watcher = null
      if (listedWhileClosed) send({ jsonrpc: '2.0', method: 'notifications/tools/list_changed' })
      listedWhileClosed = false
    } catch {
      // still closed
    }
  }, 3000)
  watcher.unref?.()
}

async function handle(msg) {
  const isRequest = msg && msg.id !== undefined && msg.id !== null
  if (!isRequest) return // notifications (initialized, cancelled…) need nothing
  const reply = (result) => send({ jsonrpc: '2.0', id: msg.id, result })
  switch (msg.method) {
    case 'initialize':
      // Answered here so the client connects even before ThumbCraft is opened.
      return reply({
        protocolVersion: (msg.params && msg.params.protocolVersion) || PROTOCOL,
        capabilities: { tools: { listChanged: true } },
        serverInfo: { name: 'thumbcraft', title: 'ThumbCraft', version: '1.0.0' }
      })
    case 'ping':
      return reply({})
  }
  if (msg.method === 'tools/call' && msg.params && msg.params.name === 'thumbcraft_status') {
    try {
      await post({ jsonrpc: '2.0', id: 'probe', method: 'ping' })
      return reply({ content: [{ type: 'text', text: 'ThumbCraft is open; its tools are ready.' }] })
    } catch {
      watchForApp()
      return reply({ content: [{ type: 'text', text: `${NOT_RUNNING}\nDetails: ${lastError}` }] })
    }
  }
  try {
    const answer = await post(msg)
    if (answer) send(answer)
  } catch {
    if (msg.method === 'tools/list') {
      listedWhileClosed = true
      watchForApp()
      return reply({ tools: [WAITING_TOOL, ...savedTools()] })
    }
    if (msg.method === 'tools/call') {
      watchForApp()
      return reply({ content: [{ type: 'text', text: NOT_RUNNING }], isError: true })
    }
    send({ jsonrpc: '2.0', id: msg.id, error: { code: -32000, message: NOT_RUNNING } })
  }
}

const rl = readline.createInterface({ input: process.stdin })
rl.on('line', (line) => {
  if (!line.trim()) return
  let msg
  try {
    msg = JSON.parse(line)
  } catch {
    return send({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } })
  }
  for (const m of Array.isArray(msg) ? msg : [msg]) void handle(m)
})
rl.on('close', () => process.exit(0))
