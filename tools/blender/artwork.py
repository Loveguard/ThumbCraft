"""Original pictures for the secret scenes: an epic pixel-art "thumbnail", a crude doodle, a machine screen and
hazard stripes. Everything is drawn procedurally here; nothing comes from Minecraft.

Each function returns an RGBA float32 image (rows from the top, values 0…1).
"""

import math

import numpy as np


def _hex(c):
    c = c.lstrip("#")
    return np.array([int(c[i : i + 2], 16) / 255 for i in (0, 2, 4)], dtype=np.float32)


def _canvas(w, h, colour):
    img = np.zeros((h, w, 4), np.float32)
    img[..., :3] = _hex(colour)
    img[..., 3] = 1
    return img


def _disc(img, cx, cy, r, colour):
    h, w = img.shape[:2]
    yy, xx = np.mgrid[0:h, 0:w]
    img[(xx - cx) ** 2 + (yy - cy) ** 2 <= r * r, :3] = _hex(colour)


def _line(img, p0, p1, colour, width=1.0, wobble=0.0, seed=0):
    """A line of round dabs from p0 to p1; `wobble` shakes it like a nervous hand."""
    rng = np.random.default_rng(seed)
    h, w = img.shape[:2]
    n = max(2, int(math.hypot(p1[0] - p0[0], p1[1] - p0[1]) * 2))
    yy, xx = np.mgrid[0:h, 0:w]
    drift = 0.0
    for i in range(n + 1):
        t = i / n
        drift = drift * 0.8 + rng.uniform(-wobble, wobble)
        x = p0[0] + (p1[0] - p0[0]) * t + drift
        y = p0[1] + (p1[1] - p0[1]) * t + drift * 0.6
        img[(xx - x) ** 2 + (yy - y) ** 2 <= (width / 2) ** 2, :3] = _hex(colour)


def epic():
    """A sunset over purple mountains, a castle on the right and a hero with a glowing sword on a cliff (96×54)."""
    w, h = 96, 54
    img = _canvas(w, h, "#000000")
    top, mid, low = _hex("#2b1055"), _hex("#d6336c"), _hex("#ffb347")
    for y in range(h):
        t = y / (h * 0.62)
        c = top + (mid - top) * min(1, t * 1.4) if t < 0.7 else mid + (low - mid) * min(1, (t - 0.7) / 0.3)
        # Banded like pixel art rather than a smooth gradient.
        img[y, :, :3] = np.round(c * 10) / 10
    rng = np.random.default_rng(5)
    for _ in range(26):
        x, y = rng.integers(0, w), rng.integers(0, int(h * 0.35))
        img[y, x, :3] = 1.0
    _disc(img, w * 0.66, h * 0.55, h * 0.2, "#ffd86b")
    _disc(img, w * 0.66, h * 0.55, h * 0.15, "#fff3b0")
    # Far and near ridges.
    for x in range(w):
        far = h * 0.62 - 7 * math.sin(x * 0.17) - 4 * math.sin(x * 0.41 + 1) - (6 if 20 < x < 40 else 0) * math.sin((x - 20) / 20 * math.pi)
        img[int(far) :, x, :3] = _hex("#5a2470")
        near = h * 0.8 - 3 * math.sin(x * 0.23 + 2) - (x - w * 0.75) * 0.12 * (x > w * 0.75)
        img[int(near) :, x, :3] = _hex("#2a0f3a")
    # Castle on the right hill.
    base = int(h * 0.74)
    dark = "#16061f"
    for x0, x1, top_y in ((70, 90, base - 10), (72, 76, base - 18), (82, 86, base - 20), (77, 81, base - 14)):
        img[top_y:base + 4, x0:x1, :3] = _hex(dark)
        for x in range(x0, x1, 2):
            img[top_y - 2 : top_y, x, :3] = _hex(dark)
    for x, y in ((74, base - 14), (84, base - 16), (79, base - 10), (73, base - 6), (87, base - 6)):
        img[y : y + 2, x, :3] = _hex("#ffd34d")
    # The cliff on the left and the hero on it, sword raised and glowing.
    for x in range(0, 34):
        img[int(h * 0.7 + (x / 34) ** 2 * 10) :, x, :3] = _hex("#12051a")
    hx, hy = 18, int(h * 0.7)
    img[hy - 7 : hy, hx : hx + 2, :3] = _hex("#12051a")  # body and legs
    img[hy - 9 : hy - 7, hx : hx + 2, :3] = _hex("#12051a")  # head
    img[hy - 7, hx - 2 : hx, :3] = _hex("#12051a")  # arm
    for i in range(9):
        x, y = hx + 2 + i, hy - 7 - i
        img[y, x, :3] = _hex("#7df9ff")
        if 0 <= y - 1:
            img[y - 1, x, :3] = np.clip(img[y - 1, x, :3] * 0.4 + _hex("#7df9ff") * 0.6, 0, 1)
    sx, sy = hx + 11, hy - 16
    for dx, dy in ((0, 0), (1, 0), (-1, 0), (0, 1), (0, -1), (2, 0), (-2, 0), (0, 2), (0, -2)):
        img[sy + dy, sx + dx, :3] = 1.0
    return img


def doodle(w=128, h=72):
    """What a "$1,000 designer" delivered: a wobbly stick figure, a scribbled sun and a messy arrow."""
    img = _canvas(w, h, "#fbfaf3")
    _line(img, (4, 58), (124, 55), "#3fa34d", 2, 0.6, 1)
    # Stick figure.
    cx, cy = 52, 30
    for a in range(0, 360, 6):
        r = 6 + math.sin(a * 0.3) * 0.6
        x, y = cx + r * math.cos(math.radians(a)), cy + r * math.sin(math.radians(a))
        _line(img, (x, y), (x + 0.5, y + 0.5), "#1b1b1b", 1.4, 0, a)
    _line(img, (cx, cy + 6), (cx + 1, cy + 22), "#1b1b1b", 1.6, 0.5, 2)
    _line(img, (cx, cy + 11), (cx - 9, cy + 6), "#1b1b1b", 1.6, 0.5, 3)
    _line(img, (cx, cy + 11), (cx + 10, cy + 16), "#1b1b1b", 1.6, 0.5, 4)
    _line(img, (cx + 1, cy + 22), (cx - 6, cy + 30), "#1b1b1b", 1.6, 0.5, 5)
    _line(img, (cx + 1, cy + 22), (cx + 8, cy + 30), "#1b1b1b", 1.6, 0.5, 6)
    img[cy - 2, cx - 2, :3] = img[cy - 2, cx + 2, :3] = _hex("#1b1b1b")
    _line(img, (cx - 2, cy + 3), (cx + 2, cy + 2), "#1b1b1b", 1, 0, 7)
    # Scribbled sun with uneven rays.
    for a in range(0, 360, 25):
        r0, r1 = 6, 10 + (a % 3) * 1.5
        sx, sy = 16, 14
        _line(
            img,
            (sx + r0 * math.cos(math.radians(a)), sy + r0 * math.sin(math.radians(a))),
            (sx + r1 * math.cos(math.radians(a)), sy + r1 * math.sin(math.radians(a))),
            "#f2c200",
            1.3,
            0.3,
            a,
        )
    _disc(img, 16, 14, 5, "#ffd400")
    # A messy red arrow pointing at nothing in particular.
    _line(img, (96, 12), (74, 26), "#e3262b", 2.2, 0.8, 8)
    _line(img, (74, 26), (82, 25), "#e3262b", 2.2, 0.4, 9)
    _line(img, (74, 26), (77, 18), "#e3262b", 2.2, 0.4, 10)
    # "Handwriting" squiggles as a title.
    rng = np.random.default_rng(3)
    x = 86
    for word in (5, 3, 6):
        for _ in range(word):
            _line(img, (x, 40 + rng.uniform(-1, 1)), (x + 2, 36 + rng.uniform(-1, 1)), "#1b1b1b", 1.2, 0.2, x)
            _line(img, (x + 2, 36), (x + 4, 41), "#1b1b1b", 1.2, 0.2, x + 1)
            x += 4
        x += 3
        if x > 118:
            break
    return img


def screen(w=64, h=36):
    """The machine's screen: a tiny preview of the thumbnail it's making and an almost-full progress bar."""
    img = _canvas(w, h, "#081428")
    small = epic()[1::3, 1::3]
    img[4:22, 16:48] = small
    img[4:22, 15, :3] = img[4:22, 48, :3] = _hex("#7df9ff")
    img[3, 15:49, :3] = img[22, 15:49, :3] = _hex("#7df9ff")
    img[27:31, 8:56, :3] = _hex("#16304f")
    img[27:31, 8:49, :3] = _hex("#43e97b")
    for i in range(3):
        img[33, 26 + i * 5 : 28 + i * 5, :3] = _hex("#7df9ff")
    return img


def hazard(w=16, h=16):
    """Yellow and black warning stripes (tiles seamlessly)."""
    img = _canvas(w, h, "#f2c200")
    yy, xx = np.mgrid[0:h, 0:w]
    img[((xx + yy) // 4) % 2 == 1, :3] = _hex("#1a1a1a")
    return img


def belt(w=16, h=16):
    """Conveyor belt rubber with cross ribs."""
    img = _canvas(w, h, "#26282b")
    img[::4, :, :3] = _hex("#3a3d41")
    return img
