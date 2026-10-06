# Developing ThumbCraft

## Getting started (development)

```bash
npm install
npm run dev        # launches the Electron app with hot reload
npm test           # unit tests for the Minecraft data layer
npm run typecheck
npm run dist:win   # Windows installer (NSIS) → release/
npm run dist:mac   # macOS .dmg (run on a Mac)
npm run build:dumper  # rebuild the mob-model helper in resources/ (needs a JDK; only when editing the dumper)
```

When it starts, the app lists the Minecraft versions it found (or downloads one from Mojang, or lets you pick a
client `.jar`). That version's assets are used for everything.

## Releasing

Bump the version and push the tag; GitHub Actions builds Windows and macOS and publishes the release:

```bash
npm version minor          # or patch / major
git push --follow-tags
```

## Project layout

```
src/
  shared/                 pure TypeScript, no Electron/DOM; unit-tested
    minecraft/nbt.ts        NBT reader (+ writer for test fixtures)
    minecraft/anvil.ts      region (.mca) reader, paletted sections, terrain extraction
    minecraft/blockModel.ts blockstate + model resolver → quads
    minecraft/mesher.ts     culled, AO-shaded, biome-tinted geometry per render layer (+ fluids)
    minecraft/tints.ts      colormaps, BlockColors, biome blend, face shading
    minecraft/playerModel.ts player model boxes, skin UV net, legacy skin conversion, poses
    minecraft/worldgen.ts   biome grouping, server.properties, locate parsing
    minecraft/schematics.ts vanilla structures, Sponge .schem, Litematica, tag search
    minecraft/entityModels.ts mob model format, texture ranking, ProGuard mapping support
  main/                   Electron main process
    assets.ts               finds .minecraft, loads the jar, finds the launcher's Java
    mojang.ts               skins, version manifest, server jar download
    generator.ts            drives the vanilla server; world-save import
    mobs.ts                 runs the model dumper with the version's classpath
    index.ts                window, IPC, mcasset:// protocol for jar textures
  preload/                typed bridge (window.blockframe), see src/shared/api.ts
  renderer/               React + three.js (react-three-fiber) editor UI
tools/model-dumper/       Java helper (package dev.blockframe.dumper) that exports the game's entity models (compiled to resources/)
tests/                    vitest (the dumper test compiles stub classes when a JDK is present)
```

## How it stays accurate (nothing is guessed)

- **Terrain:** for "Generate", the app downloads the **official dedicated server jar** for your version from Mojang
  (checking its SHA-1) and runs it headlessly with your seed. It then sends `locate biome` to find the biome and
  `forceload` to generate the chunks around it, and reads the saved region files block by block. Every block, plant, tree and
  structure is placed by vanilla code. This needs Java; the app finds the runtime that the official launcher
  already installed, so most players have nothing extra to install. You need to accept the
  [Minecraft EULA](https://www.minecraft.net/eula) once, because it's Mojang's server.
- **Blocks:** blockstates and models (parents, texture variables, element rotation/rescale, face UV/rotation,
  variant x/y rotation, uvlock, multipart, weighted random variants) are resolved exactly as the game does it. Variant
  selection uses vanilla's position seed + `java.util.Random`, and unit tests check it against real JVM output.
- **Colours:** the grass/foliage colormaps, the biome climate values and the sky/fog/water colours are read from the
  jar's data. Hard-coded block tints (birch/spruce leaves, lily pads, redstone) use vanilla's constants.
- **Mobs:** entity models aren't data files in Java Edition; they're built by code. The app runs a small helper
  (`tools/model-dumper`, prebuilt in `resources/`) against your client jar and its libraries. It calls the
  game's own `LayerDefinitions.createRoots()` and bakes each model exactly as the game does. For obfuscated
  releases, names are resolved through Mojang's official mappings. The result is cached per version. The only
  inference is choosing which texture goes with a model: that pairing lives in renderer code, so the app ranks
  the jar's real textures by name and UV size, and you can choose another one.
- **Structures:** read from `data/minecraft/structure` in your jar. Village pieces appear as stored, before the game
  randomly swaps in mossy or cracked variants.
- **Skins:** Mojang profile API → session server → `textures.minecraft.net`.
- **Licensing:** no Mojang assets are shipped. Everything is read from the user's own game files at runtime
  (`*.jar` is git-ignored).

## Supported Minecraft versions

ThumbCraft targets **Java Edition 1.18 and newer** (newest versions first). Each version's capabilities are
detected from its release date (`src/shared/minecraft/compat.ts`), so the app never guesses formats:

| Version        | Status                                                                                       |
| -------------- | -------------------------------------------------------------------------------------------- |
| 1.19 – latest  | Full support.                                                                                |
| 1.18 – 1.18.2  | Full support (biome search uses the older `locatebiome` command automatically).              |
| 1.17           | Partial: builds, players, mobs, particles and text work. Biomes and world import need 1.18+. |
| 1.13 – 1.16    | Partial: as above, without mobs.                                                             |
| 1.12 and older | Not supported (pre-"flattening" block format).                                               |

Someone who only has, say, 1.20.3 installed gets everything. The app reads whatever version they pick, and the
server jar it downloads for terrain is the matching one for that version.

## Known gaps / roadmap

1. **Block entities in terrain:** chests, signs, beds and banners inside generated terrain or builds are still invisible.
   Their models are now available from the Mobs tab, so the next step is placing them automatically.
2. **Light accuracy:** block light levels come from a table of vanilla values; dynamic effects (flicker) are left out.
3. **Swamp grass noise:** swamps use vanilla's dominant colour instead of its position-noise colour.
4. **Animated textures:** the first frame is used. Water uses its still texture on every side.
5. **Mob extras:** eye/glow layers (spiders, endermen), armor and held items, and animation poses from `setupAnim`.
   Schematic sites have no public API, so searching them happens in the browser.
6. **Camera bookmarks:** save several named camera views inside a project (one saved shot exists today).
7. **More templates:** community-made layouts, and templates built on generated biomes.
8. **Code signing:** sign the Windows installer (Azure Trusted Signing or SignPath) and notarise the macOS app.
9. **Generation speed:** keep a pre-warmed server per seed (it already stays running between generations in a
   session), and cache generated areas on disk.
10. **Older worlds:** the region reader targets the 1.18+ chunk format. Older saves need to be opened once in a newer version.
