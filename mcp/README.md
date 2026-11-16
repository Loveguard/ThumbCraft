# Let Claude work in ThumbCraft (MCP)

ThumbCraft has a built-in [Model Context Protocol](https://modelcontextprotocol.io) server, so Claude can work
inside the open app itself: read the scene, add players, mobs, titles and arrows, move the camera, change the look,
start from templates, animate, look at the result (screenshots) and export. Every change shows on screen as it
happens and can be undone with Ctrl+Z.

## How it works

- While ThumbCraft is open it listens on `http://127.0.0.1:47821/mcp` (this computer only; the next free port if
  that one is taken).
- Every request needs a key. The address and key are written to `claude-bridge.json` in ThumbCraft's data folder
  (Windows: `%APPDATA%\ThumbCraft\claude-bridge.json`). The key stays the same between starts.
- Web pages can't use it (requests from a browser are refused).
- To turn it off, add `"claudeBridge": false` to `settings.json` in the same folder and restart ThumbCraft.

## Claude Desktop

Easiest: run `node mcp\install-claude-desktop.cjs` in the ThumbCraft folder and restart Claude Desktop (it adds the
entry below, keeps everything else, and saves a backup; `--remove` takes it out). Or by hand: open **Settings → Developer → Edit Config** and add ThumbCraft under `mcpServers` (keep any servers already
there), then restart Claude Desktop:

```json
{
  "mcpServers": {
    "thumbcraft": {
      "command": "node",
      "args": ["C:\\Users\\User\\ClaudePers\\mcp\\thumbcraft-mcp.cjs"]
    }
  }
}
```

Change the path if ThumbCraft is somewhere else. The launcher needs Node 18 or newer and no packages. It connects
even when ThumbCraft is closed; its tools appear as soon as the app is open.

## Claude Code

Either through the same launcher:

```
claude mcp add thumbcraft -- node <path to this folder>\thumbcraft-mcp.cjs
```

or straight to the app (copy the key from `claude-bridge.json`):

```
claude mcp add --transport http thumbcraft http://127.0.0.1:47821/mcp --header "Authorization: Bearer <key>"
```

## The tools

| Tool                                                             | What it does                                                                                   |
| ---------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `get_scene`, `get_object`                                        | Everything in the thumbnail, with ids                                                          |
| `get_options`                                                    | Valid poses, skins, fonts, stickers, effects, biomes, looks, templates, mobs, animation blocks |
| `screenshot`                                                     | The thumbnail as it would export, returned as an image Claude can see                          |
| `add_player`, `add_mob`, `add_text`, `add_sticker`, `add_effect` | Add things (real skins by username)                                                            |
| `set_ground`, `apply_template`                                   | Swap the landscape, or start from a ready-made thumbnail                                       |
| `update_object`, `remove_object`, `duplicate_object`, `arrange`  | Move, pose, restyle, delete, layer order, groups                                               |
| `set_camera`                                                     | Place the camera, or frame an object from a side                                               |
| `set_look`                                                       | Render mode, colour look, sky, sun, weather and every effect                                   |
| `history`                                                        | Undo and redo                                                                                  |
| `export_thumbnail`, `project`                                    | Save the image (or a layered .psd) and the project                                             |
| `animation`, `export_animation`                                  | Animation mode: plain-English scripts, blocks, camera moves, presets, video/GIF export         |

Files Claude saves go where it says (an absolute path), or into `Pictures\ThumbCraft` when it only gives a name.
Only image, video, .psd, .zip and .bfproj files can be written.
