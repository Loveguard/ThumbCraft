"""Builds the secret Loveguard scenes as .glb files with Blender (run headless):

    python -m venv .bpyenv && .bpyenv/bin/pip install bpy==4.2.0
    .bpyenv/bin/python tools/blender/build_secret_scenes.py [--preview DIR]

Scenes are written in ThumbCraft's coordinates (1 unit = 1 block, y up) and exported to
resources/secret/ (shipped next to the app and served to the page on tcres://secret/). Each file's anchor (bottom-centre of its bounds, where ThumbCraft places an
imported model's origin) is printed so the templates can put it back exactly where it was built.
All textures come from textures.py (original pixel art); no Minecraft files are used.
"""

import json
import math
import os
import sys

import bpy
import numpy as np

sys.path.insert(0, os.path.dirname(__file__))
import textures as T  # noqa: E402

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
OUT = os.path.join(ROOT, "resources", "secret")

# Faces a block shows: (top, side, bottom). Anything not listed uses its own tile on every side.
FACES = {
    "grass": ("grass_top", "grass_side", "dirt"),
    "oak_log": ("oak_log_top", "oak_log", "oak_log_top"),
    "spruce_log": ("spruce_log_top", "spruce_log", "spruce_log_top"),
}
CROSS = {"red_flower", "yellow_flower"}


def to_blender(p):
    """ThumbCraft (x, y up, z toward the camera) → Blender (x, y forward, z up)."""
    x, y, z = p
    return (x, -z, y)


# ---------------------------------------------------------------- materials


def atlas_image():
    img = bpy.data.images.get("blocks_atlas")
    if img:
        return img
    px = T.atlas()[::-1]  # Blender stores rows bottom-up
    img = bpy.data.images.new("blocks_atlas", T.SIZE, T.SIZE, alpha=True)
    img.pixels.foreach_set(px.ravel())
    img.pack()
    return img


def atlas_material(kind):
    """kind: 'opaque', 'cutout' (alpha clip) or 'blend' (translucent)."""
    name = f"blocks_{kind}"
    if name in bpy.data.materials:
        return bpy.data.materials[name]
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    bsdf = nt.nodes["Principled BSDF"]
    bsdf.inputs["Roughness"].default_value = 0.9
    tex = nt.nodes.new("ShaderNodeTexImage")
    tex.image = atlas_image()
    tex.interpolation = "Closest"
    nt.links.new(tex.outputs["Color"], bsdf.inputs["Base Color"])
    if kind == "cutout":
        # Round on alpha is how the glTF exporter recognises alpha clipping (MASK).
        rnd = nt.nodes.new("ShaderNodeMath")
        rnd.operation = "ROUND"
        nt.links.new(tex.outputs["Alpha"], rnd.inputs[0])
        nt.links.new(rnd.outputs[0], bsdf.inputs["Alpha"])
    elif kind == "blend":
        nt.links.new(tex.outputs["Alpha"], bsdf.inputs["Alpha"])
        bsdf.inputs["Roughness"].default_value = 0.08
    return m


def plain_material(name, colour, roughness=0.8, emission=None, strength=1.0, alpha=None):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    bsdf = m.node_tree.nodes["Principled BSDF"]
    bsdf.inputs["Base Color"].default_value = (*colour, 1)
    bsdf.inputs["Roughness"].default_value = roughness
    if emission:
        bsdf.inputs["Emission Color"].default_value = (*emission, 1)
        bsdf.inputs["Emission Strength"].default_value = strength
    if alpha is not None:
        bsdf.inputs["Alpha"].default_value = alpha
    return m


# ---------------------------------------------------------------- voxel meshing

DIRS = [
    ((0, 1, 0), "top", [(0, 1, 1), (1, 1, 1), (1, 1, 0), (0, 1, 0)]),
    ((0, -1, 0), "bottom", [(0, 0, 0), (1, 0, 0), (1, 0, 1), (0, 0, 1)]),
    ((1, 0, 0), "side", [(1, 0, 1), (1, 0, 0), (1, 1, 0), (1, 1, 1)]),
    ((-1, 0, 0), "side", [(0, 0, 0), (0, 0, 1), (0, 1, 1), (0, 1, 0)]),
    ((0, 0, 1), "side", [(0, 0, 1), (1, 0, 1), (1, 1, 1), (0, 1, 1)]),
    ((0, 0, -1), "side", [(1, 0, 0), (0, 0, 0), (0, 1, 0), (1, 1, 0)]),
]


def tile_for(block, face):
    if block in FACES:
        top, side, bottom = FACES[block]
        return {"top": top, "side": side, "bottom": bottom}[face]
    return block


def group_of(block):
    if block in T.TRANSLUCENT:
        return "blend"
    if block in T.CUTOUT or block in CROSS:
        return "cutout"
    return "opaque"


def voxel_object(name, blocks, unit=1.0, origin=(0, 0, 0)):
    """One mesh object (up to three materials) from {(x, y, z): block}, in ThumbCraft coordinates."""
    verts, faces, uvs, mats = [], [], [], []
    kinds = ["opaque", "cutout", "blend"]

    def emit(quad, tile, kind):
        base = len(verts)
        for v in quad:
            verts.append(to_blender(tuple(origin[i] + v[i] * unit for i in range(3))))
        faces.append((base, base + 1, base + 2, base + 3))
        u0, v0, u1, v1 = T.uv_rect(tile)
        uvs.extend([(u0, v0), (u1, v0), (u1, v1), (u0, v1)])
        mats.append(kinds.index(kind))

    for (x, y, z), b in blocks.items():
        kind = group_of(b)
        if b in CROSS:
            for a, c in (((0, 0), (1, 1)), ((1, 0), (0, 1))):
                quad = [(x + a[0], y, z + a[1]), (x + c[0], y, z + c[1]), (x + c[0], y + 1, z + c[1]), (x + a[0], y + 1, z + a[1])]
                emit(quad, b, kind)
            continue
        for (dx, dy, dz), face, corners in DIRS:
            n = blocks.get((x + dx, y + dy, z + dz))
            if n is not None and n not in CROSS:
                # Hidden behind an opaque block, or inside a run of the same see-through block.
                if group_of(n) == "opaque" or n == b:
                    continue
            # Bottom-left, bottom-right, top-right, top-left as seen from outside.
            quad = [(x + c[0], y + c[1], z + c[2]) for c in corners]
            emit(quad, tile_for(b, face), kind)

    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata(verts, [], faces)
    mesh.update()
    uv = mesh.uv_layers.new(name="UVMap")
    for i, loop in enumerate(mesh.loops):
        uv.data[i].uv = uvs[loop.vertex_index]
    for k in kinds:
        mesh.materials.append(atlas_material(k))
    mesh.polygons.foreach_set("material_index", mats)
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.scene.collection.objects.link(obj)
    return obj


def box(name, lo, hi, material):
    """An axis-aligned box from ThumbCraft corner lo to hi."""
    bpy.ops.mesh.primitive_cube_add(size=1)
    o = bpy.context.active_object
    o.name = name
    c = [(lo[i] + hi[i]) / 2 for i in range(3)]
    s = [abs(hi[i] - lo[i]) for i in range(3)]
    o.location = to_blender(c)
    o.scale = (s[0], s[2], s[1])
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    o.data.materials.append(material)
    return o


# ---------------------------------------------------------------- shared builders


def noise2(x, z, seed=0):
    return (
        math.sin(x * 0.11 + seed) * math.cos(z * 0.09 + seed * 0.7)
        + 0.5 * math.sin(x * 0.27 + z * 0.19 + seed * 1.3)
        + 0.25 * math.cos(x * 0.53 - z * 0.41 + seed * 2.1)
    )


def hash01(*v):
    h = 2166136261
    for n in v:
        h = (h ^ (int(n) & 0xFFFFFFFF)) * 16777619 & 0xFFFFFFFF
    h ^= h >> 13
    h = (h * 1274126177) & 0xFFFFFFFF
    return (h ^ (h >> 16)) / 4294967296


def oak(blocks, x, y, z, height=6, radius=3):
    for i in range(height):
        blocks[(x, y + i, z)] = "oak_log"
    top = y + height
    for dy in range(-2, 2):
        r = radius - (1 if dy == 1 else 0)
        for dx in range(-r, r + 1):
            for dz in range(-r, r + 1):
                if dx * dx + dz * dz <= r * r + 1 and hash01(x + dx, top + dy, z + dz) > 0.06:
                    blocks.setdefault((x + dx, top + dy, z + dz), "oak_leaves")


def pine(blocks, x, y, z, height=9):
    for i in range(height):
        blocks[(x, y + i, z)] = "spruce_log"
    for i in range(2, height + 2):
        r = max(0, (height + 1 - i) // 3) + (1 if i % 2 == 0 and i < height else 0)
        r = min(r, 3)
        for dx in range(-r, r + 1):
            for dz in range(-r, r + 1):
                if abs(dx) + abs(dz) <= r + (1 if r > 1 else 0):
                    blocks.setdefault((x + dx, y + i, z + dz), "spruce_leaves")
    blocks[(x, y + height + 1, z)] = "spruce_leaves"


# ---------------------------------------------------------------- scene 1: "Seeing Minecraft through AI"


def scene_vision():
    """A vivid valley seen from a grassy ledge: a river winding to a snowy peak, pine forests, two big oaks."""
    land = {}
    river_x = lambda z: -8 + 6 * math.sin(z * 0.05)  # noqa: E731
    # Only what the camera sees: a wedge widening with distance in front of the ledge.
    for z in range(-90, 8):
        half = 14 + max(0, -z) * 0.75
        for x in range(int(-6 - half), int(-6 + half * 0.55) + 1):
            d_river = abs(x - river_x(z))
            ledge = z > -6
            # The ledge, then a drop into the valley floor; gentle hills rise either side of the river.
            floor = -7 + 3.5 * max(0, d_river - 6) / 14 + 1.2 * noise2(x, z, 3)
            h = 0 + 0.6 * noise2(x, z, 1) if ledge else floor
            h = int(round(h))
            land[(x, h, z)] = "grass"
            land[(x, h - 1, z)] = "dirt"
            if ledge and z <= -4:
                # The ledge's face down to the valley.
                for y in range(int(floor) - 1, h - 1):
                    land[(x, y, z)] = "dirt" if hash01(x, y, z) < 0.7 else "stone"
            if not ledge and d_river <= 3:
                for y in range(h + 1, -5):
                    land[(x, y, z)] = "water"
            elif hash01(x, z, 11) < 0.02 and z > -45:
                land[(x, h + 1, z)] = "red_flower" if hash01(x, z, 5) < 0.5 else "yellow_flower"
            elif not ledge and d_river > 9 and z < -16 and hash01(x, z, 7) < 0.022:
                pine(land, x, h + 1, z, 7 + int(hash01(x, z, 9) * 5))
    oak(land, -17, 1, -1, 8, 3)
    valley = voxel_object("Valley", land)

    # A snow-capped peak at the end of the valley, from 3-unit blocks so it stays light.
    mountain = {}
    for gx in range(-30, 18):
        for gz in range(-46, -32):
            x, z = gx * 3, gz * 3
            peak = max(0.0, 1 - math.hypot(x + 12, (z + 118) * 1.2) / 46)
            side = max(0.0, 1 - math.hypot(x - 30, (z + 125) * 1.4) / 40) * 0.55
            other = max(0.0, 1 - math.hypot(x + 60, (z + 122) * 1.4) / 38) * 0.6
            h = int((max(peak, side, other) ** 1.25) * 26 + noise2(gx, gz, 5) * 1.2)
            if h < 1:
                continue
            for gy in range(-3, h + 1):
                snow_line = 13 + int(noise2(gx, gz, 8) * 1.8)
                mountain[(gx, gy, gz)] = "snow" if gy >= snow_line else "stone"
    peaks = voxel_object("Mountains", mountain, unit=3)
    return [valley, peaks]


def scene_glasses():
    """Black-framed glasses, sized for a player's head (0.5 blocks wide), facing +z."""
    frame = plain_material("glasses_frame", (0.02, 0.02, 0.02), 0.35)
    lens = plain_material("glasses_lens", (0.6, 0.75, 0.85), 0.05, alpha=0.25)
    parts = []
    t = 0.035
    for side in (-1, 1):
        cx = side * 0.13
        x0, x1, y0, y1 = cx - 0.1, cx + 0.1, -0.07, 0.07
        parts += [
            box("rim_top", (x0, y1 - t, -t / 2), (x1, y1, t / 2), frame),
            box("rim_bottom", (x0, y0, -t / 2), (x1, y0 + t, t / 2), frame),
            box("rim_left", (x0, y0, -t / 2), (x0 + t, y1, t / 2), frame),
            box("rim_right", (x1 - t, y0, -t / 2), (x1, y1, t / 2), frame),
            box("lens", (x0 + t, y0 + t, -0.004), (x1 - t, y1 - t, 0.004), lens),
            box("arm", (side * 0.255 - t / 2, y1 - t * 1.6, -0.32), (side * 0.255 + t / 2, y1 - t * 0.6, 0), frame),
        ]
    parts.append(box("bridge", (-0.03, 0.01, -t / 2), (0.03, 0.01 + t, t / 2), frame))
    return parts


# ---------------------------------------------------------------- scene 2: "Who builds best?"


def cottage(blocks, ox, oz, swaps=None, ruin=0.0, seed=0):
    """A small cottage (9×9 footprint). swaps(block) can replace blocks; ruin removes upper parts."""
    put = {}
    for x in range(9):
        for z in range(9):
            put[(x, 0, z)] = "cobble"
    for y in range(1, 5):
        for x in range(9):
            for z in range(9):
                edge = x in (0, 8) or z in (0, 8)
                if not edge:
                    continue
                corner = x in (0, 8) and z in (0, 8)
                window = y in (2, 3) and ((z in (0, 8) and x in (2, 3, 5, 6)) or (x in (0, 8) and z in (3, 5)))
                door = z == 8 and x == 4 and y in (1, 2)
                if door:
                    continue
                put[(x, y, z)] = "oak_log" if corner else "glass" if window else "oak_planks"
    # Pitched roof running along x.
    for step in range(5):
        y = 5 + step
        for x in range(-1, 10):
            for z in (step - 1, 9 - step):
                put[(x, y, z)] = "spruce_planks"
        for x in (0, 8):
            for z in range(step, 9 - step):
                put[(x, y, z)] = "oak_planks"
    for x in range(-1, 10):
        put[(x, 9, 4)] = "spruce_planks"
    for y in range(6, 11):
        put[(6, y, 2)] = "cobble"
    top = max(y for (_, y, _) in put)
    for (x, y, z), b in put.items():
        if ruin and y > 1:
            gone = hash01(x, y, z, seed) < ruin * (0.35 + y / top) + (0.4 if x > 4 and y > 2 else 0) * ruin
            if gone:
                if hash01(x, z, seed + 3) < 0.35:
                    rx, rz = x + int(hash01(x, y, seed) * 5) - 2, z + int(hash01(z, y, seed) * 5) - 2
                    blocks.setdefault((ox + rx, 1, oz + rz), "cobble" if b == "cobble" else "oak_planks")
                continue
        blocks[(ox + x, y, oz + z)] = swaps(b, x, y, z) if swaps else b


def scene_builds():
    """The judging table with four small builds, and dark pillars in the distance."""
    objects = []
    # Table: 16×4 top, 3 high, legs at the corners (same footprint as the in-app table template).
    table = {}
    for x in range(-8, 8):
        for z in range(-2, 2):
            table[(x, 2, z)] = "spruce_planks"
    for x in (-7, 6):
        for z in (-2, 1):
            for y in range(2):
                table[(x, y, z)] = "spruce_log"
    objects.append(voxel_object("Table", table))

    # A dark floor under everything, fading into the night.
    floor = {}
    for x in range(-10, 10):
        for z in range(-15, 4):
            floor[(x, -1, z)] = "obsidian"
    objects.append(voxel_object("Floor", floor, unit=4))

    # Four builds at a quarter of block size, standing on the table top (y = 3).
    s = 0.25
    def build(name, ox, rotate=0.0, tilt=0.0, **kw):  # noqa: E306
        blocks = {}
        cottage(blocks, 0, 0, **kw)
        o = voxel_object(name, blocks, unit=s, origin=(-4.5 * s, 0, -4.5 * s))
        o.location = to_blender((ox, 3.0, 0.1))
        o.rotation_euler = (math.radians(tilt), 0, math.radians(rotate))
        return o

    rainbow = lambda b, x, y, z: b if b in ("glass", "red_flower", "yellow_flower") else f"wool_{int(hash01(x, y, z) * 10)}"  # noqa: E731
    wonky = lambda b, x, y, z: ("cobble" if hash01(x, y, z, 4) < 0.15 else "dark_planks") if b == "oak_planks" and hash01(x, y, z, 2) < 0.4 else b  # noqa: E731
    objects += [
        build("Build 1", -5.6, rotate=-12),
        build("Build 2", -1.9, rotate=18, tilt=-5, swaps=wonky, ruin=0.12, seed=2),
        build("Build 3", 1.9, rotate=-8, swaps=rainbow),
        build("Build 4", 5.6, rotate=10, ruin=0.55, seed=7),
    ]

    pillars = {}
    for i, (px, pz, h) in enumerate([(-30, -36, 34), (-17, -44, 40), (-6, -52, 30), (9, -46, 44), (22, -38, 36), (33, -50, 32)]):
        w = 3 + i % 2
        for y in range(-12, h):
            for dx in range(w):
                for dz in range(w):
                    pillars[(px + dx, y, pz + dz)] = "obsidian"
    objects.append(voxel_object("Pillars", pillars))
    return objects


# ---------------------------------------------------------------- scene 3: "Bosses coded by AI"


def scene_boss():
    """A hulking spiked boss in a bright white hall: a skin-modifier body (one connected mesh) plus spikes."""
    skin_mat = plain_material("boss_skin", (0.045, 0.05, 0.055), 0.6)

    # Skeleton: (point, radius) joints and the bones between them, in ThumbCraft coordinates.
    joints = []
    bones = []

    def chain(points, radii, start=None):
        idx = []
        for p, r in zip(points, radii):
            joints.append((p, r))
            idx.append(len(joints) - 1)
        if start is not None:
            bones.append((start, idx[0]))
        bones.extend(zip(idx, idx[1:]))
        return idx

    lerp = lambda a, b, t: tuple(a[i] + (b[i] - a[i]) * t for i in range(3))  # noqa: E731
    # Hunched spine from hips to neck, leaning toward the camera (+z); head thrust forward and low.
    spine = chain(
        [(0, 6.0, -7.0), (0, 8.2, -6.8), (0, 10.4, -6.0), (0, 12.0, -4.6), (0, 12.6, -3.0), (0, 12.2, -1.6)],
        [2.0, 2.4, 2.8, 2.6, 1.6, 1.7],
    )
    for side in (-1, 1):
        # Legs: wide, bent, heavy.
        chain(
            [(side * 1.8, 5.2, -7.0), (side * 2.8, 3.0, -6.0), (side * 3.0, 0.9, -7.2), (side * 3.2, 0.25, -6.4)],
            [1.3, 1.05, 0.8, 0.7],
            start=spine[0],
        )
        # Long arms from huge shoulders, reaching forward and down toward the camera.
        arm = chain(
            [
                (side * 3.3, 11.4, -4.4),
                (side * 4.6, 9.2, -2.6),
                (side * 5.2, 6.6, -0.6),
                (side * 5.0, 4.6, 1.4),
            ],
            [1.9, 1.25, 0.95, 0.75],
            start=spine[3],
        )
        # Clawed fingers spread out from the wrist.
        for k in (-1, 0, 1):
            chain(
                [lerp((side * 5.0, 4.6, 1.4), (side * (5.4 + 0.5 * k), 3.4, 2.8 + 0.3 * k), t) for t in (0.4, 1.0)]
                + [(side * (5.6 + 0.8 * k), 2.4, 3.6 + 0.4 * k)],
                [0.45, 0.3, 0.12],
                start=arm[-1],
            )

    verts = [to_blender(p) for p, _ in joints]
    mesh = bpy.data.meshes.new("boss")
    mesh.from_pydata(verts, bones, [])
    obj = bpy.data.objects.new("Boss", mesh)
    bpy.context.scene.collection.objects.link(obj)
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)
    skin = obj.modifiers.new("skin", "SKIN")
    skin.use_smooth_shade = True
    for i, (_, r) in enumerate(joints):
        mesh.skin_vertices[0].data[i].radius = (r, r)
    mesh.skin_vertices[0].data[0].use_root = True
    sub = obj.modifiers.new("smooth", "SUBSURF")
    sub.levels = 2
    # Rough, lumpy hide.
    tex = bpy.data.textures.new("lumps", "CLOUDS")
    tex.noise_scale = 0.55
    disp = obj.modifiers.new("lumps", "DISPLACE")
    disp.texture = tex
    disp.strength = 0.6
    for m in ("skin", "smooth", "lumps"):
        bpy.ops.object.modifier_apply(modifier=m)
    body = obj
    body.data.materials.append(skin_mat)

    # Spikes along the back, shoulders and head.
    spikes = []
    def spike(p, length, tilt_x, tilt_y, radius=0.4):  # noqa: E306
        bpy.ops.mesh.primitive_cone_add(vertices=6, radius1=radius, depth=length, location=to_blender(p))
        c = bpy.context.active_object
        c.rotation_euler = (math.radians(tilt_x), math.radians(tilt_y), 0)
        c.data.materials.append(skin_mat)
        spikes.append(c)

    for i in range(14):
        t = i / 13
        p = lerp((0, 8.0, -9.0), (0, 13.6, -4.4), t)
        off = math.sin(i * 2.3) * 1.3
        spike((off, p[1], p[2]), 1.3 + hash01(i) * 1.6, -40 - t * 40, off * 18)
    for side in (-1, 1):
        for i in range(5):
            spike((side * (2.4 + i * 0.7), 13.2 - i * 0.45, -4.6 + i * 0.25), 2.2 + hash01(i, side) * 1.4, -5, -side * (20 + i * 10), 0.48)
    for i in range(4):
        spike(((i - 1.5) * 0.7, 13.9, -2.4), 1.3, -25, (i - 1.5) * 22, 0.26)

    bpy.ops.object.select_all(action="DESELECT")
    for o in spikes + [body]:
        o.select_set(True)
    bpy.context.view_layer.objects.active = body
    bpy.ops.object.join()
    dec = body.modifiers.new("decimate", "DECIMATE")
    dec.ratio = 0.5
    bpy.ops.object.modifier_apply(modifier="decimate")

    # The hall: floor, walls and ceiling, with a blinding white end wall behind the boss.
    hall = plain_material("hall", (0.82, 0.82, 0.84), 0.5)
    glow = plain_material("glow", (1, 1, 1), 0.5, emission=(1, 1, 1), strength=6.0)
    parts = [
        box("Floor", (-10, -0.2, -36), (10, 0, 6), hall),
        box("Wall L", (-10.4, 0, -36), (-10, 20, 6), hall),
        box("Wall R", (10, 0, -36), (10.4, 20, 6), hall),
        box("Ceiling", (-10.4, 20, -36), (10.4, 20.4, -16), hall),
        box("Light", (-10, 0, -36.4), (10, 20, -36), glow),
    ]
    return [body] + parts


# ---------------------------------------------------------------- export


def bounds_app(objs):
    """Bounds of objects in ThumbCraft coordinates."""
    import mathutils  # noqa: F401

    lo = [math.inf] * 3
    hi = [-math.inf] * 3
    for o in objs:
        for c in o.bound_box:
            w = o.matrix_world @ __import__("mathutils").Vector(c)
            p = (w.x, w.z, -w.y)
            for i in range(3):
                lo[i] = min(lo[i], p[i])
                hi[i] = max(hi[i], p[i])
    return lo, hi


def export(name, objs, normals=True):
    bpy.context.view_layer.update()
    lo, hi = bounds_app(objs)
    anchor = [(lo[0] + hi[0]) / 2, lo[1], (lo[2] + hi[2]) / 2]
    bpy.ops.object.select_all(action="DESELECT")
    for o in objs:
        o.select_set(True)
    os.makedirs(OUT, exist_ok=True)
    path = os.path.join(OUT, f"{name}.glb")
    bpy.ops.export_scene.gltf(
        filepath=path,
        export_format="GLB",
        use_selection=True,
        export_apply=True,
        export_yup=True,
        export_materials="EXPORT",
        export_image_format="AUTO",
        export_normals=normals,
    )
    size = os.path.getsize(path)
    tris = sum(len(o.data.polygons) for o in objs if o.type == "MESH")
    print(f"{name}: anchor {[round(v, 3) for v in anchor]}, {size / 1024:.0f} KB, {tris} faces")
    return {"anchor": [round(v, 4) for v in anchor], "bytes": size}


def preview(path, cam_pos, cam_target, fov, sky, sun_dir, sun=3.0, res=(960, 540)):
    """A quick Cycles render from the template's camera, to check the models."""
    scene = bpy.context.scene
    scene.render.engine = "CYCLES"
    scene.cycles.samples = 24
    scene.cycles.device = "CPU"
    scene.render.resolution_x, scene.render.resolution_y = res
    scene.render.filepath = path
    world = bpy.data.worlds.new("w") if not scene.world else scene.world
    scene.world = world
    world.use_nodes = True
    world.node_tree.nodes["Background"].inputs[0].default_value = (*sky, 1)
    world.node_tree.nodes["Background"].inputs[1].default_value = 1.0
    cam_data = bpy.data.cameras.new("cam")
    cam_data.angle_y = math.radians(fov)
    cam_data.sensor_fit = "VERTICAL"
    cam_data.clip_end = 2000
    cam = bpy.data.objects.new("cam", cam_data)
    scene.collection.objects.link(cam)
    cam.location = to_blender(cam_pos)
    d = [cam_target[i] - cam_pos[i] for i in range(3)]
    direction = __import__("mathutils").Vector(to_blender(d))
    cam.rotation_euler = direction.to_track_quat("-Z", "Y").to_euler()
    scene.camera = cam
    sun_data = bpy.data.lights.new("sun", "SUN")
    sun_data.energy = sun
    s = bpy.data.objects.new("sun", sun_data)
    scene.collection.objects.link(s)
    s.rotation_euler = __import__("mathutils").Vector(to_blender(sun_dir)).to_track_quat("-Z", "Y").to_euler()
    bpy.ops.render.render(write_still=True)
    for o in (cam, s):
        bpy.data.objects.remove(o)


def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def main():
    preview_dir = sys.argv[sys.argv.index("--preview") + 1] if "--preview" in sys.argv else None
    info = {}

    reset()
    objs = scene_vision()
    info["vision"] = export("vision", objs, normals=False)
    if preview_dir:
        preview(os.path.join(preview_dir, "vision.png"), (-3, 5.0, 6.0), (-9, -5, -40), 60, (0.45, 0.7, 1.0), (-0.5, -0.8, -0.4))

    reset()
    info["glasses"] = export("glasses", scene_glasses())

    reset()
    objs = scene_builds()
    info["builds"] = export("builds", objs, normals=False)
    if preview_dir:
        preview(os.path.join(preview_dir, "builds.png"), (0, 5.6, 9.5), (0, 3.4, 0), 50, (0.12, 0.06, 0.25), (0.3, -0.8, -0.5))

    reset()
    objs = scene_boss()
    info["boss"] = export("boss", objs)
    if preview_dir:
        preview(os.path.join(preview_dir, "boss.png"), (0.4, 0.6, 7.5), (0, 6.5, -4), 72, (1, 1, 1), (0, -0.3, 1), sun=0.5)

    with open(os.path.join(OUT, "anchors.json"), "w") as f:
        json.dump({k: v["anchor"] for k, v in info.items()}, f, indent=2)


if __name__ == "__main__":
    main()
