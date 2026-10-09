"""Builds the secret Loveguard scenes (thumbnail ideas for the ThumbCraft launch video) as .glb files with
Blender (run headless):

    python -m venv .bpyenv && .bpyenv/bin/pip install bpy==4.2.0
    .bpyenv/bin/python tools/blender/build_secret_scenes.py [--preview DIR]

Scenes are written in ThumbCraft's coordinates (1 unit = 1 block, y up) and exported to
resources/secret/ (shipped next to the app and served to the page on tcres://secret/). Each file's anchor (bottom-centre of its bounds, where ThumbCraft places an
imported model's origin) is printed so the templates can put it back exactly where it was built.
All textures come from textures.py and artwork.py (original pixel art); no Minecraft files are used.
"""

import json
import math
import os
import sys

import bpy
import numpy as np

sys.path.insert(0, os.path.dirname(__file__))
import artwork as A  # noqa: E402
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


# ---------------------------------------------------------------- props shared by the scenes


def metal_material(name, colour, roughness=0.35, metallic=0.8):
    m = plain_material(name, colour, roughness)
    m.node_tree.nodes["Principled BSDF"].inputs["Metallic"].default_value = metallic
    return m


def image_material(name, pixels, emission=0.0, repeat=False):
    """A material showing one of artwork.py's pictures, pixel-sharp; `emission` makes it glow like a screen."""
    h, w = pixels.shape[:2]
    img = bpy.data.images.new(name, w, h, alpha=True)
    img.pixels.foreach_set(pixels[::-1].ravel())
    img.pack()
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    bsdf = nt.nodes["Principled BSDF"]
    bsdf.inputs["Roughness"].default_value = 0.6
    tex = nt.nodes.new("ShaderNodeTexImage")
    tex.image = img
    tex.interpolation = "Closest"
    tex.extension = "REPEAT" if repeat else "EXTEND"
    nt.links.new(tex.outputs["Color"], bsdf.inputs["Base Color"])
    if emission:
        nt.links.new(tex.outputs["Color"], bsdf.inputs["Emission Color"])
        bsdf.inputs["Emission Strength"].default_value = emission
    return m


def quad(name, corners, material, repeat=(1, 1)):
    """One flat face through four ThumbCraft points (bottom-left, bottom-right, top-right, top-left as seen from
    the front), showing the whole picture (or `repeat` copies of it)."""
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata([to_blender(c) for c in corners], [], [(0, 1, 2, 3)])
    mesh.update()
    uv = mesh.uv_layers.new(name="UVMap")
    ru, rv = repeat
    for i, (u, v) in enumerate([(0, 0), (ru, 0), (ru, rv), (0, rv)]):
        uv.data[i].uv = (u, v)
    mesh.materials.append(material)
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.scene.collection.objects.link(obj)
    return obj


def front_quad(name, x0, x1, y0, y1, z, material, repeat=(1, 1)):
    """A picture facing the camera (+z) at depth z."""
    return quad(name, [(x0, y0, z), (x1, y0, z), (x1, y1, z), (x0, y1, z)], material, repeat)


def cyl(name, a, b, radius, material, verts=16, radius2=None):
    """A cylinder (or cone with `radius2`) from ThumbCraft point a to point b."""
    import mathutils

    pa, pb = mathutils.Vector(to_blender(a)), mathutils.Vector(to_blender(b))
    d = pb - pa
    if radius2 is None:
        bpy.ops.mesh.primitive_cylinder_add(vertices=verts, radius=radius, depth=d.length, location=(pa + pb) / 2)
    else:
        bpy.ops.mesh.primitive_cone_add(vertices=verts, radius1=radius, radius2=radius2, depth=d.length, location=(pa + pb) / 2)
    o = bpy.context.active_object
    o.name = name
    o.rotation_euler = d.to_track_quat("Z", "Y").to_euler()
    o.data.materials.append(material)
    return o


def place(objs, at=(0, 0, 0), yaw=0.0, tilt=0.0, roll=0.0):
    """Joins parts built around the origin into one object, then turns (degrees: yaw about y, tilt about x, roll
    about z) and moves it to `at`, all in ThumbCraft terms."""
    bpy.ops.object.select_all(action="DESELECT")
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    # Bake every part's own placement into its mesh first, so the joined object starts from no transform at all.
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    if len(objs) > 1:
        bpy.ops.object.join()
    o = bpy.context.active_object
    # ThumbCraft y (up) is Blender z; ThumbCraft x tilt is Blender x; ThumbCraft z roll is Blender -y.
    o.rotation_euler = (math.radians(tilt), math.radians(-roll), math.radians(yaw))
    o.location = to_blender(at)
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    return o


def picture_frame(art, width, height, border, frame_mat):
    """A framed picture standing on its bottom edge, centred on x = 0, facing +z."""
    hw = width / 2
    parts = [
        front_quad("picture", -hw, hw, border, height + border, 0.06, art),
        box("frame_back", (-hw - border, 0, -0.08), (hw + border, height + 2 * border, 0.05), frame_mat),
        box("frame_top", (-hw - border, height + border, 0.05), (hw + border, height + 2 * border, 0.16), frame_mat),
        box("frame_bottom", (-hw - border, 0, 0.05), (hw + border, border, 0.16), frame_mat),
        box("frame_left", (-hw - border, 0, 0.05), (-hw, height + 2 * border, 0.16), frame_mat),
        box("frame_right", (hw, 0, 0.05), (hw + border, height + 2 * border, 0.16), frame_mat),
    ]
    return parts


# ---------------------------------------------------------------- scene 1: "It makes thumbnails?!"


def scene_machine():
    """A blocky thumbnail machine: cobblestone rides a conveyor in, a glowing framed thumbnail comes out."""
    body = metal_material("machine_body", (0.55, 0.58, 0.62), 0.38, 0.75)
    trim = metal_material("machine_trim", (0.16, 0.17, 0.19), 0.45, 0.6)
    red = plain_material("button_red", (0.85, 0.08, 0.06), 0.35, emission=(1, 0.1, 0.05), strength=1.5)
    hole = plain_material("intake", (0.01, 0.01, 0.01), 1.0)
    gold = metal_material("gold", (1.0, 0.72, 0.18), 0.28, 1.0)
    floor = plain_material("studio_floor", (0.07, 0.075, 0.09), 0.65)
    stripes = image_material("hazard", A.hazard(), repeat=True)
    rubber = image_material("belt", A.belt(), repeat=True)
    screen = image_material("screen", A.screen(), emission=2.5)
    art = image_material("thumbnail_art", A.epic(), emission=2.2)
    lamp = plain_material("lamp", (0.4, 1, 0.5), 0.3, emission=(0.3, 1, 0.45), strength=4)

    objs = [box("Floor", (-40, -0.2, -40), (40, 0, 20), floor)]

    # The machine: a steel cabinet on a dark plinth, a funnel on top, chimneys at the back.
    m = [
        box("plinth", (-3.4, 0, -7.4), (3.4, 0.5, -1.6), trim),
        box("cabinet", (-3, 0.5, -7), (3, 6.6, -2), body),
        box("cap", (-3.2, 6.6, -7.2), (3.2, 7.0, -1.8), trim),
        front_quad("hazard_band", -3, 3, 0.55, 1.25, -1.99, stripes, repeat=(9, 1)),
        box("screen_bezel", (-2.5, 2.9, -2.02), (2.5, 5.95, -1.9), trim),
        front_quad("screen", -2.25, 2.25, 3.1, 5.75, -1.89, screen),
        cyl("button", (2.3, 1.8, -2.0), (2.3, 1.8, -1.6), 0.32, red),
        cyl("lamp", (-2.3, 1.8, -2.0), (-2.3, 1.8, -1.75), 0.22, lamp),
        cyl("funnel", (0, 7.0, -4.5), (0, 9.4, -4.5), 1.2, body, verts=4, radius2=2.8),
        cyl("chimney_1", (-2, 7.0, -6.2), (-2, 10.5, -6.2), 0.45, trim),
        cyl("chimney_2", (-0.6, 7.0, -6.4), (-0.6, 9.4, -6.4), 0.35, trim),
    ]
    for x in (-3.0, 3.0):
        for y in (1.4, 6.2):
            m.append(box("bolt", (x - 0.12 if x < 0 else x - 0.02, y, -2.12), (x + 0.02 if x < 0 else x + 0.12, y + 0.14, -1.98), trim))
    # The intake on the left and the chute on the right.
    m.append(quad("intake", [(-3.01, 1.4, -3.4), (-3.01, 1.4, -5.6), (-3.01, 3.2, -5.6), (-3.01, 3.2, -3.4)], hole))
    m.append(box("intake_rim", (-3.25, 3.2, -5.8), (-2.95, 3.5, -3.2), trim))
    m.append(place([box("chute", (0, -0.15, -1.1), (3.2, 0.15, 1.1), trim)], at=(3.0, 2.6, -4.2), roll=-28))
    objs += m

    # The lever on the machine's left side.
    objs.append(box("lever_base", (-3.5, 2.0, -2.6), (-3.0, 2.6, -2.2), trim))
    objs.append(cyl("lever", (-3.3, 2.3, -2.4), (-4.4, 3.9, -2.2), 0.08, trim))
    bpy.ops.mesh.primitive_uv_sphere_add(radius=0.28, location=to_blender((-4.45, 4.0, -2.2)), segments=16, ring_count=8)
    knob = bpy.context.active_object
    knob.data.materials.append(red)
    objs.append(knob)

    # The conveyor feeding the intake, with legs and rollers, carrying plain cobblestone.
    belt_top = 1.55
    objs += [
        box("conveyor_frame", (-15, belt_top - 0.45, -5.7), (-3.0, belt_top - 0.05, -3.3), trim),
        quad("belt", [(-15, belt_top, -3.4), (-3.0, belt_top, -3.4), (-3.0, belt_top, -5.6), (-15, belt_top, -5.6)], rubber, repeat=(16, 3)),
    ]
    for x in (-14.5, -10.5, -6.5):
        for z in (-5.5, -3.5):
            objs.append(box("leg", (x - 0.12, 0, z - 0.12), (x + 0.12, belt_top - 0.45, z + 0.12), trim))
    for x in range(-15, -3, 2):
        objs.append(cyl("roller", (x + 0.5, belt_top - 0.25, -5.75), (x + 0.5, belt_top - 0.25, -3.25), 0.2, body, verts=10))
    cubes = {}
    for x in (-13, -10, -7):
        cubes[(x, 0, 0)] = "cobble"
    objs.append(voxel_object("Cobblestone", cubes, unit=1.1, origin=(0.2, belt_top, -5.05)))

    # What comes out: a big framed thumbnail, glowing, flying off the chute.
    frame = picture_frame(art, 6.4, 3.6, 0.28, gold)
    objs.append(place(frame, at=(8.2, 0.9, -3.0), yaw=-22, roll=6))
    return objs


# ---------------------------------------------------------------- scene 2: "How I fake my thumbnails"


def scene_studio():
    """A film set: green screen, softbox lights on stands, a cinema camera on a tripod and a boom mic."""
    green = plain_material("green_screen", (0.05, 0.62, 0.2), 0.9, emission=(0.04, 0.5, 0.15), strength=0.12)
    floor = plain_material("studio_floor", (0.2, 0.2, 0.22), 0.55)
    black = plain_material("matte_black", (0.025, 0.025, 0.028), 0.5)
    steel = metal_material("steel", (0.6, 0.62, 0.66), 0.3, 0.9)
    soft = plain_material("softbox", (1, 1, 1), 0.5, emission=(1, 0.97, 0.9), strength=9)
    glass = plain_material("lens_glass", (0.05, 0.1, 0.2), 0.05, emission=(0.2, 0.5, 1.0), strength=0.6)
    red = plain_material("rec_light", (1, 0.05, 0.05), 0.3, emission=(1, 0.05, 0.05), strength=6)
    fuzz = plain_material("mic_fuzz", (0.32, 0.32, 0.34), 1.0)
    objs = [box("Floor", (-40, -0.2, -40), (40, 0, 20), floor)]

    # Green screen: back wall, floor and a stepped cove between them so there's no visible corner.
    objs += [
        box("screen_wall", (-11, 0, -13.2), (11, 11, -13), green),
        box("screen_floor", (-11, 0, -13), (11, 0.03, -3.5), green),
    ]
    for i in range(6):
        a = (i + 0.5) / 6 * math.pi / 2
        r = 1.6
        y = r - r * math.cos(a)
        z = -13 + r - r * math.sin(a)
        objs.append(box("cove", (-11, 0, -13), (11, y + 0.05, z), green))

    def stand(height):
        parts = [cyl("pole", (0, 0.9, 0), (0, height, 0), 0.06, steel)]
        for k in range(3):
            a = math.radians(k * 120 + 30)
            parts.append(cyl("leg", (0, 0.95, 0), (math.cos(a) * 0.9, 0.02, math.sin(a) * 0.9), 0.045, steel))
        return parts

    # Two big softboxes aimed at the set.
    for x, z, yaw in ((-7.2, -3.2, -62), (7.6, -2.6, 60)):
        parts = stand(4.6)
        parts += [
            box("softbox_body", (-1.3, 4.2, -0.9), (1.3, 6.0, 0.3), black),
            cyl("softbox_neck", (0, 5.1, 0.3), (0, 5.1, 0.9), 0.25, black),
        ]
        parts.append(front_quad("softbox_face", -1.2, 1.2, 4.3, 5.9, -0.91, soft))
        # Built facing -z (toward the set), then turned toward the middle.
        objs.append(place(parts, at=(x, 0, z), yaw=yaw))

    # The cinema camera on its tripod in the foreground, pointed at the set.
    cam = stand(2.2)
    cam += [
        box("head", (-0.3, 2.15, -0.35), (0.3, 2.35, 0.35), black),
        box("body", (-0.45, 2.35, -1.1), (0.45, 3.25, 0.9), black),
        cyl("lens", (0, 2.8, -1.1), (0, 2.8, -2.1), 0.32, black, verts=20),
        cyl("lens_ring", (0, 2.8, -1.7), (0, 2.8, -1.85), 0.36, steel, verts=20),
        box("matte_box", (-0.6, 2.38, -2.45), (0.6, 3.22, -2.1), black),
        cyl("eyepiece", (-0.55, 3.0, 0.6), (-0.55, 3.0, 1.15), 0.12, black),
        cyl("handle", (0.3, 2.6, 0.9), (0.3, 2.6, 1.9), 0.05, steel),
        box("monitor", (0.5, 3.0, -0.4), (0.56, 3.55, 0.4), black),
        cyl("reel_front", (-0.12, 3.75, -0.55), (0.12, 3.75, -0.55), 0.55, black, verts=24),
        cyl("reel_back", (-0.12, 3.75, 0.5), (0.12, 3.75, 0.5), 0.55, black, verts=24),
        cyl("rec", (0.3, 3.15, -1.12), (0.3, 3.15, -1.16), 0.06, red),
    ]
    lens_face = cyl("lens_glass", (0, 2.8, -2.1), (0, 2.8, -2.12), 0.27, glass, verts=20)
    cam.append(lens_face)
    objs.append(place(cam, at=(-3.4, 0, 1.2), yaw=-24))

    # A boom mic hanging over the set from the right.
    boom = [
        cyl("boom_pole", (6.5, 6.4, -3.5), (1.2, 5.6, -7.0), 0.06, steel),
        cyl("mic", (1.4, 5.5, -7.1), (0.2, 5.3, -7.5), 0.22, fuzz, verts=12),
    ]
    objs += boom
    return objs


# ---------------------------------------------------------------- scene 3: "$1,000 vs $0"


def scene_gallery():
    """Two easels in a gallery: a crude doodle on the left, a glowing epic picture in a gold frame on the right."""
    wall = plain_material("gallery_wall", (0.32, 0.05, 0.09), 0.85)
    floor = plain_material("gallery_floor", (0.16, 0.09, 0.05), 0.65)
    wood = plain_material("easel_wood", (0.55, 0.36, 0.18), 0.7)
    gold = metal_material("gold", (1.0, 0.72, 0.18), 0.25, 1.0)
    white = plain_material("canvas_edge", (0.95, 0.94, 0.9), 0.9)
    doodle = image_material("doodle_art", A.doodle())
    art = image_material("epic_art", A.epic(), emission=1.6)
    objs = [
        box("Floor", (-30, -0.2, -30), (30, 0, 20), floor),
        box("Wall", (-30, 0, -8.2), (30, 14, -8), wall),
        box("Rail", (-30, 8.0, -8.0), (30, 8.25, -7.85), gold),
        box("Skirting", (-30, 0, -8.0), (30, 0.4, -7.85), gold),
    ]

    def easel(canvas_parts):
        lean = 10
        legs = [
            cyl("leg_l", (-1.1, 0, 0.4), (-0.25, 5.6, -0.4), 0.08, wood, verts=8),
            cyl("leg_r", (1.1, 0, 0.4), (0.25, 5.6, -0.4), 0.08, wood, verts=8),
            cyl("leg_back", (0, 0, -1.6), (0, 5.3, -0.45), 0.07, wood, verts=8),
            box("ledge", (-1.6, 1.05, 0.05), (1.6, 1.2, 0.45), wood),
        ]
        canvas = place(canvas_parts, at=(0, 1.2, 0.2), tilt=-lean)
        return legs + [canvas]

    hw, h = 2.4, 2.7
    left_canvas = [
        front_quad("doodle", -hw, hw, 0.05, h - 0.05, 0.07, doodle),
        box("stretcher", (-hw, 0, -0.05), (hw, h, 0.06), white),
    ]
    right_canvas = picture_frame(art, 2 * hw - 0.4, h - 0.4, 0.2, gold)
    objs.append(place(easel(left_canvas), at=(-3.9, 0, -2.4), yaw=14))
    objs.append(place(easel(right_canvas), at=(3.9, 0, -2.4), yaw=-14))

    # Velvet rope posts in front, like a museum piece.
    for x in (-6.6, 6.6):
        objs.append(cyl("post", (x, 0, 1.6), (x, 1.5, 1.6), 0.1, gold, verts=12))
    return objs


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
    info["machine"] = export("machine", scene_machine())
    if preview_dir:
        preview(os.path.join(preview_dir, "machine.png"), (0.5, 2.4, 13.5), (0.5, 3.4, -3), 50, (0.02, 0.03, 0.06), (0.4, -0.7, -0.6), sun=2.0)

    reset()
    info["studio"] = export("studio", scene_studio())
    if preview_dir:
        preview(os.path.join(preview_dir, "studio.png"), (-0.6, 2.9, 7.5), (0.8, 1.9, -7), 52, (0.05, 0.05, 0.06), (0.2, -0.8, -0.5), sun=2.5)

    reset()
    info["gallery"] = export("gallery", scene_gallery())
    if preview_dir:
        preview(os.path.join(preview_dir, "gallery.png"), (0, 2.7, 10.5), (0, 2.4, -2), 50, (0.05, 0.03, 0.04), (0.1, -0.8, -0.6), sun=2.5)

    with open(os.path.join(OUT, "anchors.json"), "w") as f:
        json.dump({k: v["anchor"] for k, v in info.items()}, f, indent=2)


if __name__ == "__main__":
    main()
