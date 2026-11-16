// The tools Claude gets for working inside ThumbCraft (served by src/main/claude.ts, carried out by
// src/renderer/src/claudeBridge.ts). Names are what Claude calls; schemas are JSON Schema.

export interface ClaudeTool {
  name: string
  title: string
  description: string
  inputSchema: Record<string, unknown>
  readOnly?: boolean
  destructive?: boolean
  /** Can take minutes (video export, mob models on first use). */
  slow?: boolean
}

const vec3 = (what: string): Record<string, unknown> => ({
  type: 'array',
  items: { type: 'number' },
  minItems: 3,
  maxItems: 3,
  description: what
})
const obj = (properties: Record<string, unknown>, required: string[] = []): Record<string, unknown> => ({
  type: 'object',
  properties,
  ...(required.length && { required }),
  additionalProperties: false
})
const id = { type: 'string', description: 'Object id from get_scene' }
const place = {
  position: vec3('Where it goes, in blocks [x, y, z] (y up). Leave out to put it where the camera is looking.'),
  yaw: {
    type: 'number',
    description: 'Which way it faces, degrees around the vertical. Leave out to face the camera.'
  },
  scale: { type: 'number', description: '1 = normal size' },
  name: { type: 'string', description: 'Layer name shown in the layer list' }
}
const screenSpot = {
  x: { type: 'number', description: 'Horizontal centre in the frame, 0 = left edge … 1 = right edge' },
  y: { type: 'number', description: 'Vertical centre in the frame, 0 = top … 1 = bottom' },
  height: { type: 'number', description: 'How tall it is as a share of the frame height (0.15 is a big title line)' }
}

export const CLAUDE_TOOLS: ClaudeTool[] = [
  // ------------------------------------------------------------ looking
  {
    name: 'get_scene',
    title: 'Read the scene',
    description:
      'Everything in the open thumbnail: every object (layer) with its id, kind, name, position, rotation and main ' +
      'settings, plus the camera, scene settings (look, lighting, weather), colour effects, sky, selection, the ' +
      'project name and whether Animation mode is on. Call this first and after big changes.',
    inputSchema: obj({}),
    readOnly: true
  },
  {
    name: 'get_object',
    title: 'Read one object',
    description: "All the fields of one object (e.g. a player's full pose and equipment, a text's fonts and outlines).",
    inputSchema: obj({ id }, ['id']),
    readOnly: true
  },
  {
    name: 'get_options',
    title: 'List valid choices',
    description:
      'Valid ids for everything else: player poses and joints, default skins, fonts, text styles, stickers, ' +
      'effects (vfx), lights, ready-made biomes, sky presets, render modes, colour looks, templates, animation ' +
      'blocks, camera moves, animation presets, and mobs (mob list needs the models read from the game, which ' +
      'can take a minute the first time; pass include_mobs).',
    inputSchema: obj({ include_mobs: { type: 'boolean' } }),
    readOnly: true,
    slow: true
  },
  {
    name: 'screenshot',
    title: 'Look at the thumbnail',
    description:
      'Renders the thumbnail exactly as it would export (effects, titles, stickers) and returns the image so you ' +
      'can see it. Default 960×540 JPEG; waits for the scene to finish building first.',
    inputSchema: obj({
      width: { type: 'number', description: 'Pixels, up to 1920 (height follows the export aspect unless given)' },
      height: { type: 'number' },
      format: { type: 'string', enum: ['jpg', 'png'] }
    }),
    readOnly: true
  },

  // ------------------------------------------------------------ adding
  {
    name: 'add_player',
    title: 'Add a player',
    description:
      "Adds a Minecraft player. Give a username to download that player's real skin, or skin for a default " +
      '(steve, alex, ari, efe, kai, makena, noor, sunny, zuri). pose is a pose name from get_options.',
    inputSchema: obj({
      username: { type: 'string', description: 'Real Minecraft username; fetches the skin from Mojang' },
      skin: { type: 'string', description: 'Default skin name when there is no username' },
      slim: { type: 'boolean', description: 'Slim (Alex) arms for a default skin' },
      pose: { type: 'string' },
      name_tag: { type: 'boolean', description: 'Show the name above the head' },
      ...place
    })
  },
  {
    name: 'add_text',
    title: 'Add a title',
    description:
      'Adds words. style "caption" is the flat YouTube title drawn on top of everything (outline + shadow); ' +
      '"pixel" is 3D Minecraft-font letters; "stone" is a carved stone logo; "hardcore" is red letters with ♥ for O. ' +
      'For captions, place it on the frame with x/y/height (recommended); 3D text uses position/yaw like objects.',
    inputSchema: obj(
      {
        text: { type: 'string', description: 'Use \\n for a second line' },
        style: { type: 'string', enum: ['caption', 'pixel', 'stone', 'hardcore'] },
        color: { type: 'string', description: 'Fill colour, #rrggbb' },
        outline_color: { type: 'string' },
        outline_width: { type: 'number', description: 'Captions: outline thickness (14 default)' },
        font: { type: 'string', description: 'Captions: font label from get_options (Impact, Anton, Luckiest Guy…)' },
        system_font: { type: 'string', description: 'Captions: a font installed on this computer (see list_fonts)' },
        shadow: { type: 'boolean', description: 'Captions: drop shadow (default true)' },
        gradient: { type: 'string', description: 'Captions: bottom colour for a top→bottom fade' },
        glow: { type: 'string', description: 'Captions: glow colour' },
        ...screenSpot,
        ...place
      },
      ['text']
    )
  },
  {
    name: 'add_sticker',
    title: 'Add an arrow or shape',
    description:
      'Adds a 2D thumbnail sticker on top of the picture: arrow, arrow-curve, circle, cross, check, burst, box. ' +
      'Placed by frame fractions; rotation in degrees (arrows point right at 0, so 90 points down).',
    inputSchema: obj(
      {
        shape: { type: 'string', enum: ['arrow', 'arrow-curve', 'circle', 'cross', 'check', 'burst', 'box'] },
        color: { type: 'string' },
        x: screenSpot.x,
        y: screenSpot.y,
        size: { type: 'number', description: 'Share of the frame height (0.28 default, box 0.4)' },
        rotation: { type: 'number' },
        flip: { type: 'boolean' },
        outline: { type: 'boolean' },
        glow: { type: 'boolean' }
      },
      ['shape']
    )
  },
  {
    name: 'add_mob',
    title: 'Add a mob',
    description:
      'Adds a mob from the game (zombie, creeper, warden, ender_dragon…, ids from get_options include_mobs). The ' +
      'first time it reads the models from the game, which can take a minute.',
    inputSchema: obj({ mob: { type: 'string', description: 'e.g. "zombie" or "minecraft:zombie#main"' }, ...place }, [
      'mob'
    ]),
    slow: true
  },
  {
    name: 'add_image',
    title: 'Add a picture',
    description:
      'Adds a flat picture layer: a file on this computer (file: absolute path to .png/.jpg/.webp/.gif), raw PNG/JPG ' +
      'bytes (data: base64), or a texture from the game (texture: e.g. "item/diamond_sword", "block/diamond_ore", ' +
      '"item/ender_pearl"; drawn with crisp pixels). Place it on the frame with x/y/height (it faces the camera; ' +
      'depth = blocks in front of the camera, large depth puts it behind the scene as a backdrop) and roll to tilt ' +
      'it, or in the world with position/yaw/scale (height 4 blocks at scale 1). on_top draws it over everything.',
    inputSchema: obj({
      file: { type: 'string' },
      data: { type: 'string', description: 'base64 PNG or JPG' },
      texture: { type: 'string' },
      ...screenSpot,
      depth: { type: 'number', description: 'Blocks in front of the camera (default 2)' },
      roll: { type: 'number', description: 'Tilt in degrees around the view direction' },
      on_top: { type: 'boolean' },
      opacity: { type: 'number' },
      tint: { type: 'string' },
      pixelated: { type: 'boolean' },
      ...place
    }),
    slow: true
  },
  {
    name: 'add_block',
    title: 'Add a block',
    description:
      "Adds a single real Minecraft block as a 3D object (drawn with the game's textures): e.g. " +
      '"minecraft:grass_block", "minecraft:diamond_ore", "minecraft:tnt". Place it in the world with position, or on ' +
      'the frame with x/y/depth; rotation [x,y,z] in degrees tumbles it; scale makes it bigger.',
    inputSchema: obj(
      {
        block: { type: 'string' },
        properties: { type: 'object', additionalProperties: { type: 'string' } },
        x: screenSpot.x,
        y: screenSpot.y,
        depth: { type: 'number', description: 'Blocks in front of the camera when placed with x/y (default 6)' },
        rotation: vec3('Degrees'),
        ...place
      },
      ['block']
    )
  },
  {
    name: 'list_fonts',
    title: 'Find fonts on this computer',
    description:
      'Searches the fonts installed on this computer (every word must match, e.g. "archivo black"). Use a result\'s ' +
      'full name as system_font in add_text or update_object; the font is embedded in the project.',
    inputSchema: obj({ search: { type: 'string' } }),
    readOnly: true
  },
  {
    name: 'add_effect',
    title: 'Add an effect',
    description:
      'Adds a scene effect: smoke, fog, fire, explosion and the other vfx ids from get_options, or "lightning" for ' +
      'a lightning bolt, or a light preset ("Point light", "Spotlight", "Rim light", "Window shadows", "Leaf shadows").',
    inputSchema: obj(
      {
        effect: { type: 'string' },
        color: { type: 'string' },
        density: { type: 'number', description: '0…1, vfx only' },
        ...place
      },
      ['effect']
    )
  },
  {
    name: 'set_ground',
    title: 'Change the landscape',
    description:
      'Replaces the ground with a ready-made biome (meadow, forest, taiga, desert, island, cave, nether, ravine). ' +
      'Instant; builds and characters stay.',
    inputSchema: obj({ biome: { type: 'string' } }, ['biome'])
  },
  {
    name: 'apply_template',
    title: 'Start from a template',
    description:
      'Replaces the scene with a ready-made thumbnail (ids from get_options). The old scene stays in Recent.',
    inputSchema: obj({ template: { type: 'string' } }, ['template']),
    destructive: true,
    slow: true
  },

  // ------------------------------------------------------------ editing
  {
    name: 'update_object',
    title: 'Change an object',
    description:
      'Changes fields of one object. Common fields: position [x,y,z], rotation [x,y,z] degrees, yaw (shortcut for ' +
      'rotation[1]), scale, visible, name, onTop, flat. Players: pose (a pose name, or {joint:[x,y,z]} to bend ' +
      'single joints on top of the current pose), equipment {head, chest, legs, feet: material like "diamond"; ' +
      'mainHand, offHand: item id like "diamond_sword"}, slim, nameTag. Text: text, color, outlineColor, ' +
      'outlineWidth, font (label), system_font (installed font, see list_fonts), shadow, gradient, glow. Mobs: partRotations {part:[x,y,z]}. Lights: color, ' +
      'intensity, range, angle. Stickers: x, y, size, color, rotation as in add_sticker. look_at: [x,y,z] or an ' +
      'object id to turn it to face that. Players, mobs, models, 3D text and builds: rim {color, intensity 0-4, ' +
      'angle (screen degrees the light comes from: 0 right, 90 top, 180 left), width (720p pixels), wrap 0-1} ' +
      'paints a rim light on that object only (null removes it).',
    inputSchema: obj(
      {
        id,
        changes: { type: 'object', description: 'Fields to set', additionalProperties: true },
        look_at: { description: 'Turn to face a point [x,y,z] or another object id' }
      },
      ['id']
    )
  },
  {
    name: 'remove_object',
    title: 'Delete an object',
    description: 'Deletes one or more objects (undo brings them back).',
    inputSchema: obj({ ids: { type: 'array', items: { type: 'string' } } }, ['ids']),
    destructive: true
  },
  {
    name: 'duplicate_object',
    title: 'Duplicate an object',
    description: 'Copies an object; the copy lands one block over and is returned.',
    inputSchema: obj({ id }, ['id'])
  },
  {
    name: 'arrange',
    title: 'Layer order and selection',
    description:
      'Selects objects in the editor (so the user sees them highlighted), moves one up or down the layer list ' +
      '(later = drawn on top for flat layers), or groups/ungroups the selection.',
    inputSchema: obj({
      select: { type: 'array', items: { type: 'string' } },
      reorder: obj({ id, by: { type: 'number', description: '+1 up, -1 down' } }, ['id', 'by']),
      group: { type: 'boolean', description: 'true groups the selection, false ungroups it' }
    })
  },
  {
    name: 'set_camera',
    title: 'Move the camera',
    description:
      'Sets the view: position and target [x,y,z], fov in degrees. Or frame an object id from a direction ' +
      '(front/left/right/back/above/low) at a distance. Also saves it as the shot unless save_shot is false.',
    inputSchema: obj({
      position: vec3('Camera position'),
      target: vec3('Point the camera looks at'),
      fov: { type: 'number' },
      frame: obj(
        {
          id,
          from: { type: 'string', enum: ['front', 'left', 'right', 'back', 'above', 'low'] },
          distance: { type: 'number', description: 'Blocks away (default 4)' }
        },
        ['id']
      ),
      save_shot: { type: 'boolean' }
    })
  },
  {
    name: 'set_look',
    title: 'Change the look',
    description:
      'Scene-wide settings in one call. render_mode: vanilla, cinematic, soft, cartoon, custom. look: a colour ' +
      'look id (fuji, teal-orange, night, noir, horror, neon) or null; look_intensity 0…1. sky: a sky preset; ' +
      'sky_color for the colour preset. settings: SceneSettings fields (sunAzimuth, sunElevation, sunStrength, ' +
      'ambientStrength, weather none/rain/snow, fog, exportWidth, exportHeight, exportFormat…). effects: ' +
      'EffectSettings fields (exposure, contrast, saturation, temperature, bloom, bloomIntensity, vignette, ' +
      'depthOfField, godRays, grain, crt, warp, burst, streaks, paper, lightLeak…). get_scene shows current values.',
    inputSchema: obj({
      render_mode: { type: 'string' },
      look: { type: ['string', 'null'] },
      look_intensity: { type: 'number' },
      sky: { type: 'string' },
      sky_color: { type: 'string' },
      settings: { type: 'object', additionalProperties: true },
      effects: { type: 'object', additionalProperties: true }
    })
  },
  {
    name: 'history',
    title: 'Undo or redo',
    description: 'Undoes or redoes the last changes (steps times).',
    inputSchema: obj({ action: { type: 'string', enum: ['undo', 'redo'] }, steps: { type: 'number' } }, ['action'])
  },

  // ------------------------------------------------------------ files
  {
    name: 'export_thumbnail',
    title: 'Export the thumbnail',
    description:
      'Renders the thumbnail at the export size (scene settings exportWidth × exportHeight, 1280×720 by default) ' +
      'and saves it. path: an absolute file path, or a file name saved in Pictures\\ThumbCraft. Also layered=true ' +
      'saves a Photoshop .psd with each layer separate.',
    inputSchema: obj({
      path: { type: 'string' },
      format: { type: 'string', enum: ['jpg', 'png'] },
      layered: { type: 'boolean' }
    })
  },
  {
    name: 'project',
    title: 'New or save project',
    description:
      'action "new" starts an empty project (the current one stays in Recent); "save" saves the project to its ' +
      'file, or to path (.bfproj) when given; "rename" sets the project name.',
    inputSchema: obj(
      {
        action: { type: 'string', enum: ['new', 'save', 'rename'] },
        path: { type: 'string' },
        name: { type: 'string' }
      },
      ['action']
    ),
    destructive: true
  },

  // ------------------------------------------------------------ animation
  {
    name: 'animation',
    title: 'Animate',
    description:
      'Animation mode (characters moving over time, exported as video). action: "enter"/"exit" the mode; ' +
      '"script" turns plain English into timeline blocks (text, e.g. "Steve walks to the tree, then waves. Alex ' +
      'jumps."); "add_block" adds a block (type from get_options animation blocks) to id at time at (seconds, ' +
      'default after its last block; length sets its seconds); "go_to" makes id travel to point over the terrain; ' +
      '"add_camera" adds a camera move (camera type, at, length; position/target/fov give it its own start view, ' +
      'which makes a hard cut; subject is the character it frames); "preset" applies an animation preset (preset ' +
      'id) to id; "clear" removes id\'s blocks (id "camera" for the camera row; block removes one block by its id); ' +
      '"seek" moves the playhead to time; "get" reads the timeline.',
    inputSchema: obj(
      {
        action: {
          type: 'string',
          enum: ['enter', 'exit', 'script', 'add_block', 'go_to', 'add_camera', 'preset', 'clear', 'seek', 'get']
        },
        id,
        text: { type: 'string' },
        type: { type: 'string' },
        camera: { type: 'string' },
        preset: { type: 'string' },
        at: { type: 'number' },
        length: { type: 'number' },
        time: { type: 'number' },
        point: vec3('Destination for go_to'),
        upper_body: { type: 'boolean', description: 'add_block on the upper-body row (players only)' },
        travel: { type: 'string', enum: ['walk', 'run', 'sprint', 'sneak'] },
        position: vec3('add_camera: where the camera starts'),
        target: vec3('add_camera: the point it starts looking at'),
        fov: { type: 'number', description: 'add_camera: field of view in degrees' },
        subject: { type: 'string', description: 'add_camera: object id of the character it frames' },
        block: { type: 'string', description: 'clear: the id of one block to remove' }
      },
      ['action']
    )
  },
  {
    name: 'export_glb',
    title: 'Export a character for Blender',
    description:
      'Saves one player or mob, moving as it does in the animation (body, limbs and place every frame), as a ' +
      'binary glTF (.glb) for Blender. id: the character. path as in export_thumbnail.',
    inputSchema: obj({ id: { type: 'string' }, path: { type: 'string' } }, ['id']),
    slow: true
  },
  {
    name: 'export_animation',
    title: 'Export the animation',
    description:
      'Renders the animation to a file: kind video (MP4/WebM), gif, png (zip of frames) or alpha (transparent ' +
      'WebM); size thumb, 1080p, 720p, shorts, square. path as in export_thumbnail. Takes a while.',
    inputSchema: obj({
      path: { type: 'string' },
      kind: { type: 'string', enum: ['video', 'gif', 'png', 'alpha'] },
      size: { type: 'string', enum: ['thumb', '1080p', '720p', 'shorts', 'square'] },
      motion_blur: { type: 'number', description: 'Frames blended per frame, 1 = off' },
      follow: { type: 'string', description: 'Object id to keep centred (for Shorts)' }
    }),
    slow: true
  }
]
