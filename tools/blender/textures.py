"""Original 16×16 pixel-art block textures for the secret scenes, packed into one atlas.

Everything here is drawn procedurally (seeded noise and simple patterns); nothing is taken from Minecraft.
"""

import numpy as np

TILE = 16
PAD = 8  # each tile sits in a 32-pixel cell, padded with copies of its own edge pixels
CELL = TILE + 2 * PAD
GRID = 16  # tiles per atlas row
SIZE = CELL * GRID


def _rng(seed):
    return np.random.default_rng(seed)


def _hex(c):
    c = c.lstrip("#")
    return np.array([int(c[i : i + 2], 16) / 255 for i in (0, 2, 4)], dtype=np.float32)


def _noise(seed, base, spread, size=TILE):
    """Per-pixel brightness variation around a base colour (RGB 0…1)."""
    r = _rng(seed)
    v = r.uniform(-spread, spread, (size, size, 1)).astype(np.float32)
    rgb = np.clip(_hex(base)[None, None, :] * (1 + v), 0, 1)
    return np.concatenate([rgb, np.ones((size, size, 1), np.float32)], axis=2)


def _blotches(img, seed, colour, chance):
    r = _rng(seed)
    mask = r.uniform(0, 1, (TILE, TILE)) < chance
    img[mask, :3] = np.clip(_hex(colour)[None, :] * r.uniform(0.85, 1.15, (mask.sum(), 1)), 0, 1)
    return img


def grass_top(s):
    return _blotches(_noise(s, "#5fae3a", 0.16), s + 1, "#4c9a2c", 0.22)


def dirt(s):
    return _blotches(_noise(s, "#8a5a36", 0.18), s + 1, "#6e4428", 0.18)


def grass_side(s):
    img = dirt(s)
    r = _rng(s + 7)
    top = _noise(s + 3, "#5fae3a", 0.15)
    for x in range(TILE):
        depth = 3 + int(r.integers(0, 3))
        img[:depth, x] = top[:depth, x]
    return img


def stone(s):
    return _blotches(_noise(s, "#8b8d90", 0.12), s + 1, "#6f7174", 0.2)


def snow(s):
    return _noise(s, "#f1f6fb", 0.05)


def sand(s):
    return _noise(s, "#e2cf92", 0.08)


def water(s):
    img = _noise(s, "#2f6fd6", 0.12)
    r = _rng(s + 2)
    for _ in range(6):
        y, x = r.integers(0, TILE, 2)
        img[y, x : x + 4, :3] = _hex("#8fc6ff")
    return img


def log_side(s, base, dark):
    img = _noise(s, base, 0.08)
    for x in range(0, TILE, 4):
        img[:, x, :3] = _hex(dark)
    r = _rng(s + 5)
    for _ in range(10):
        y, x = r.integers(0, TILE, 2)
        img[y, x, :3] = _hex(dark)
    return img


def log_top(s, bark, inner):
    img = _noise(s, inner, 0.06)
    yy, xx = np.mgrid[0:TILE, 0:TILE]
    d = np.maximum(abs(xx - 7.5), abs(yy - 7.5))
    img[d > 6.5, :3] = _hex(bark)
    img[(d > 2.5) & (d < 3.5), :3] *= 0.85
    return img


def leaves(s, base):
    img = _noise(s, base, 0.22)
    r = _rng(s + 9)
    holes = r.uniform(0, 1, (TILE, TILE)) < 0.18
    img[holes, 3] = 0
    return img


def planks(s, base):
    img = _noise(s, base, 0.07)
    for y in (3, 7, 11, 15):
        img[y, :, :3] *= 0.72
    r = _rng(s + 4)
    for row in range(4):
        x = int(r.integers(2, 14))
        img[row * 4 : row * 4 + 3, x, :3] *= 0.75
    return img


def cobble(s):
    img = _noise(s, "#7c7f82", 0.1)
    r = _rng(s + 6)
    for _ in range(9):
        y, x = r.integers(0, TILE - 4, 2)
        h, w = r.integers(3, 6, 2)
        tone = r.uniform(0.85, 1.12)
        img[y : y + h, x : x + w, :3] = np.clip(img[y : y + h, x : x + w, :3] * tone, 0, 1)
        img[y + h - 1, x : x + w, :3] *= 0.7
        img[y : y + h, x + w - 1, :3] *= 0.7
    return img


def glass(s):
    img = np.zeros((TILE, TILE, 4), np.float32)
    img[..., :3] = _hex("#cfe8f0")
    img[..., 3] = 0.12
    img[0, :, 3] = img[-1, :, 3] = img[:, 0, 3] = img[:, -1, 3] = 0.9
    img[2:4, 2, 3] = img[2, 2:5, 3] = 0.55
    return img


def wool(s, colour):
    return _noise(s, colour, 0.07)


def obsidian(s):
    img = _blotches(_noise(s, "#1d1430", 0.25), s + 1, "#3b2366", 0.15)
    return img


def white(s):
    return _noise(s, "#f4f4f4", 0.02)


def flowers(s, colour):
    img = np.zeros((TILE, TILE, 4), np.float32)
    img[8:, 7:9, :3] = _hex("#3f8a2a")
    img[8:, 7:9, 3] = 1
    img[4:8, 5:11, :3] = _hex(colour)
    img[4:8, 5:11, 3] = 1
    img[5:7, 7:9, :3] = _hex("#ffe066")
    return img


RAINBOW = ["#e8443a", "#f08a2c", "#f2d03b", "#67c23a", "#3fb5e6", "#3c5fd6", "#8a4fd8", "#d94fb2", "#f2f2f2", "#58708a"]

# name → painter. The order fixes each tile's place in the atlas.
TILES = {
    "grass_top": grass_top,
    "grass_side": grass_side,
    "dirt": dirt,
    "stone": stone,
    "snow": snow,
    "sand": sand,
    "water": water,
    "oak_log": lambda s: log_side(s, "#6b4a2b", "#4a321c"),
    "oak_log_top": lambda s: log_top(s, "#6b4a2b", "#b88b52"),
    "spruce_log": lambda s: log_side(s, "#3f2b1a", "#2a1b0f"),
    "spruce_log_top": lambda s: log_top(s, "#3f2b1a", "#8e6a41"),
    "oak_leaves": lambda s: leaves(s, "#4f9a2e"),
    "spruce_leaves": lambda s: leaves(s, "#2f5e34"),
    "oak_planks": lambda s: planks(s, "#b58b55"),
    "spruce_planks": lambda s: planks(s, "#6e4c2c"),
    "dark_planks": lambda s: planks(s, "#4a321f"),
    "cobble": cobble,
    "glass": glass,
    "obsidian": obsidian,
    "white": white,
    "red_flower": lambda s: flowers(s, "#e8443a"),
    "yellow_flower": lambda s: flowers(s, "#f2d03b"),
    **{f"wool_{i}": (lambda c: lambda s: wool(s, c))(c) for i, c in enumerate(RAINBOW)},
}

INDEX = {name: i for i, name in enumerate(TILES)}

# Tiles drawn with see-through pixels (cut out) or as translucent glass/water.
CUTOUT = {"oak_leaves", "spruce_leaves", "red_flower", "yellow_flower"}
TRANSLUCENT = {"glass", "water"}


def atlas():
    """The RGBA atlas, rows from the top (as images are usually stored)."""
    img = np.zeros((SIZE, SIZE, 4), np.float32)
    for name, paint in TILES.items():
        i = INDEX[name]
        x, y = (i % GRID) * CELL, (i // GRID) * CELL
        # Edge padding keeps distant (mipmapped) blocks from picking up the neighbouring tile's colours.
        img[y : y + CELL, x : x + CELL] = np.pad(paint(1000 + i * 17), ((PAD, PAD), (PAD, PAD), (0, 0)), mode="edge")
    return img


def uv_rect(name):
    """(u0, v0, u1, v1) of a tile, with v measured from the bottom (Blender/glTF convention after flipping)."""
    i = INDEX[name]
    x, y = (i % GRID) * CELL + PAD, (i // GRID) * CELL + PAD
    # Inset a fraction of a texel so neighbouring tiles never bleed in.
    e = 0.2
    return ((x + e) / SIZE, 1 - (y + TILE - e) / SIZE, (x + TILE - e) / SIZE, 1 - (y + e) / SIZE)
