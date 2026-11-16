#!/usr/bin/env node
// Adds ThumbCraft to Claude Desktop's MCP servers (claude_desktop_config.json), keeping everything else in the
// file as it is. Run it once: `node mcp/install-claude-desktop.cjs`, then restart Claude Desktop.
// `node mcp/install-claude-desktop.cjs --remove` takes the entry out again.
'use strict'
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const dir =
  process.platform === 'win32'
    ? path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), 'Claude')
    : process.platform === 'darwin'
      ? path.join(os.homedir(), 'Library', 'Application Support', 'Claude')
      : path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'), 'Claude')
const file = path.join(dir, 'claude_desktop_config.json')
const launcher = path.join(__dirname, 'thumbcraft-mcp.cjs')

let config = {}
if (fs.existsSync(file)) {
  try {
    config = JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch (e) {
    console.error(`Could not read ${file} (${e.message}); nothing was changed.`)
    process.exit(1)
  }
  fs.copyFileSync(file, file + '.before-thumbcraft')
}
config.mcpServers ??= {}
if (process.argv.includes('--remove')) delete config.mcpServers.thumbcraft
else config.mcpServers.thumbcraft = { command: 'node', args: [launcher] }
fs.mkdirSync(dir, { recursive: true })
fs.writeFileSync(file, JSON.stringify(config, null, 2) + '\n')
console.log(
  process.argv.includes('--remove')
    ? `Removed ThumbCraft from ${file}.`
    : `Added ThumbCraft to ${file}\n(the old file is kept as claude_desktop_config.json.before-thumbcraft).\nRestart Claude Desktop to load it.`
)
