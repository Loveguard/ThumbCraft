// Reads blocks and biomes out of Anvil region files (.mca), Java Edition 1.18+ chunk format, and cuts a box of
// terrain out of them (port of shared/minecraft/anvil.ts).
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::collections::{BTreeMap, HashMap};

use crate::nbt::{self, Nbt};
use crate::util::Res;

const SECTOR: usize = 4096;
/// A real chunk is well under a megabyte unpacked; anything far larger is corrupt or hostile.
const MAX_CHUNK: usize = 16 * 1024 * 1024;

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct BlockState {
    pub name: String,
    pub properties: BTreeMap<String, String>,
}

impl BlockState {
    pub fn key(&self) -> String {
        if self.properties.is_empty() {
            return self.name.clone();
        }
        let props: Vec<String> = self.properties.iter().map(|(k, v)| format!("{k}={v}")).collect();
        format!("{}[{}]", self.name, props.join(","))
    }
}

/// Returns the raw (decompressed) NBT root of a chunk, or None if the chunk isn't in the file.
pub fn read_chunk_from_region(region: &[u8], local_x: i32, local_z: i32) -> Res<Option<Nbt>> {
    let idx = 4 * ((local_x & 31) + (local_z & 31) * 32) as usize;
    if idx + 4 > region.len() {
        return Ok(None);
    }
    let offset = ((region[idx] as usize) << 16) | ((region[idx + 1] as usize) << 8) | region[idx + 2] as usize;
    let sectors = region[idx + 3];
    if offset == 0 || sectors == 0 {
        return Ok(None);
    }
    let start = offset * SECTOR;
    if start + 5 > region.len() {
        return Ok(None);
    }
    let length = u32::from_be_bytes(region[start..start + 4].try_into().unwrap()) as usize;
    let compression = region[start + 4];
    if compression & 0x80 != 0 {
        return Err("Chunk stored in external .mcc file is not supported yet".into());
    }
    let end = (start + 4 + length).min(region.len());
    let data = &region[(start + 5).min(end)..end];
    let root = match compression {
        1 => nbt::parse(&nbt::inflate_capped(data, true, MAX_CHUNK)?)?,
        2 => nbt::parse(&nbt::inflate_capped(data, false, MAX_CHUNK)?)?,
        3 => nbt::parse(data)?,
        c => {
            return Err(format!(
                "Chunk compression type {c} is not supported (set region-file-compression=deflate)"
            ))
        }
    };
    Ok(Some(root))
}

/// Unpacks a 1.16+ paletted container (entries never span two longs).
pub fn unpack_paletted_indices(data: Option<&[i64]>, bits: u32, count: usize) -> Vec<u16> {
    let mut out = vec![0u16; count];
    let Some(data) = data else { return out };
    if bits == 0 {
        return out;
    }
    let per_long = (64 / bits) as usize;
    let mask = (1u64 << bits) - 1;
    let mut i = 0;
    'outer: for &l in data {
        let l = l as u64;
        for k in 0..per_long {
            if i >= count {
                break 'outer;
            }
            out[i] = ((l >> (k as u32 * bits)) & mask) as u16;
            i += 1;
        }
    }
    out
}

fn bits_for(n: usize) -> u32 {
    if n <= 1 {
        0
    } else {
        (n as f64).log2().ceil() as u32
    }
}

/// Parses "minecraft:oak_stairs[facing=east,half=bottom]".
pub fn parse_block_string(s: &str) -> BlockState {
    let s = s.trim();
    let (name, props) = match s.find('[') {
        Some(i) if s.ends_with(']') => (&s[..i], Some(&s[i + 1..s.len() - 1])),
        Some(_) => return BlockState { name: "minecraft:air".into(), properties: BTreeMap::new() },
        None => (s, None),
    };
    if name.is_empty() {
        return BlockState { name: "minecraft:air".into(), properties: BTreeMap::new() };
    }
    let mut properties = BTreeMap::new();
    for pair in props.unwrap_or("").split(',') {
        let mut kv = pair.splitn(2, '=');
        if let (Some(k), Some(v)) = (kv.next(), kv.next()) {
            if !k.trim().is_empty() {
                properties.insert(k.trim().to_string(), v.trim().to_string());
            }
        }
    }
    let name = if name.contains(':') { name.to_string() } else { format!("minecraft:{name}") };
    BlockState { name, properties }
}

/// A block state as saved in NBT palettes: {Name, Properties} (1.18–1.21), {id, properties} (26.x), or the
/// "minecraft:oak_stairs[facing=north]" string form.
pub fn block_state_from_nbt(v: &Nbt) -> Res<BlockState> {
    if let Nbt::Str(s) = v {
        return Ok(parse_block_string(s));
    }
    let c = v.compound();
    let name = c.and_then(|c| c.get("Name").or_else(|| c.get("name")).or_else(|| c.get("id")));
    let Some(Nbt::Str(name)) = name else {
        let shape = match c {
            Some(c) => {
                let mut keys: Vec<String> =
                    c.keys().map(|k| if k.is_empty() { "\"\"".into() } else { k.clone() }).collect();
                keys.sort();
                format!("an entry with keys {}", if keys.is_empty() { "none".into() } else { keys.join(", ") })
            }
            None => "a non-compound value".into(),
        };
        return Err(format!("This Minecraft version saves blocks in a format ThumbCraft can't read yet ({shape})"));
    };
    if name.contains('[') {
        return Ok(parse_block_string(name));
    }
    let mut properties = BTreeMap::new();
    if let Some(raw) = c.and_then(|c| c.get("Properties").or_else(|| c.get("properties"))).and_then(Nbt::compound) {
        for (k, val) in raw {
            properties.insert(k.clone(), val.to_js_string());
        }
    }
    let name = if name.contains(':') { name.clone() } else { format!("minecraft:{name}") };
    Ok(BlockState { name, properties })
}

const AIR: [&str; 3] = ["minecraft:air", "minecraft:cave_air", "minecraft:void_air"];

pub struct PaletteEntry {
    pub state: BlockState,
    pub key: String,
    pub air: bool,
}

pub struct Section {
    palette: Vec<PaletteEntry>,
    /// 4096 palette indices, index = (y*16 + z)*16 + x
    blocks: Vec<u16>,
    biome_palette: Vec<String>,
    /// 64 biome palette indices, index = (y*4 + z)*4 + x (4x4x4 cells)
    biomes: Vec<u16>,
}

pub struct Chunk {
    pub status: String,
    sections: HashMap<i32, Section>,
}

pub fn decode_chunk(root: &Nbt) -> Res<Chunk> {
    if root.get("Level").and_then(Nbt::compound).is_some() {
        return Err("This world was saved by Minecraft 1.17 or older. Open it once in 1.18+ to upgrade it.".into());
    }
    let mut sections = HashMap::new();
    for s in root.get("sections").and_then(Nbt::list).unwrap_or(&[]) {
        let Some(bs) = s.get("block_states").filter(|b| b.compound().is_some()) else { continue };
        let bi = s.get("biomes");
        let mut palette = Vec::new();
        for p in bs.get("palette").and_then(Nbt::list).unwrap_or(&[]) {
            let state = block_state_from_nbt(p)?;
            let air = AIR.contains(&state.name.as_str());
            palette.push(PaletteEntry { key: state.key(), state, air });
        }
        let block_bits = if palette.len() <= 1 { 0 } else { bits_for(palette.len()).max(4) };
        let biome_palette: Vec<String> =
            bi.and_then(|b| b.get("palette")).and_then(Nbt::list).unwrap_or(&[]).iter().map(Nbt::to_js_string).collect();
        let longs = |n: Option<&Nbt>| match n {
            Some(Nbt::LongArray(a)) => Some(a.clone()),
            _ => None,
        };
        let block_data = longs(bs.get("data"));
        let biome_data = longs(bi.and_then(|b| b.get("data")));
        let y = s.get("Y").and_then(Nbt::as_f64).unwrap_or(0.0) as i32;
        sections.insert(
            y,
            Section {
                blocks: unpack_paletted_indices(block_data.as_deref(), block_bits, 4096),
                biomes: unpack_paletted_indices(biome_data.as_deref(), bits_for(biome_palette.len()), 64),
                palette,
                biome_palette,
            },
        );
    }
    let status = root.get("Status").map(Nbt::to_js_string).unwrap_or_default();
    Ok(Chunk { status, sections })
}

/// Reads region bytes for region (rx, rz), or None if that region file doesn't exist.
pub type RegionSource = Box<dyn Fn(i32, i32) -> Option<Vec<u8>> + Send>;

pub struct ChunkCache {
    source: RegionSource,
    regions: HashMap<(i32, i32), Option<Vec<u8>>>,
    chunks: HashMap<(i32, i32), Option<Chunk>>,
}

impl ChunkCache {
    pub fn new(source: RegionSource) -> Self {
        ChunkCache { source, regions: HashMap::new(), chunks: HashMap::new() }
    }

    pub fn chunk(&mut self, cx: i32, cz: i32) -> Res<Option<&Chunk>> {
        if !self.chunks.contains_key(&(cx, cz)) {
            let (rx, rz) = (cx >> 5, cz >> 5);
            if !self.regions.contains_key(&(rx, rz)) {
                let r = (self.source)(rx, rz);
                self.regions.insert((rx, rz), r);
            }
            let chunk = match &self.regions[&(rx, rz)] {
                Some(region) => match read_chunk_from_region(region, cx & 31, cz & 31)? {
                    Some(root) => Some(decode_chunk(&root)?),
                    None => None,
                },
                None => None,
            };
            self.chunks.insert((cx, cz), chunk);
        }
        Ok(self.chunks[&(cx, cz)].as_ref())
    }

    pub fn block(&mut self, x: i32, y: i32, z: i32) -> Res<Option<&PaletteEntry>> {
        let Some(c) = self.chunk(x >> 4, z >> 4)? else { return Ok(None) };
        let Some(s) = c.sections.get(&(y >> 4)) else { return Ok(None) };
        let i = (((y & 15) * 16 + (z & 15)) * 16 + (x & 15)) as usize;
        Ok(s.palette.get(s.blocks[i] as usize))
    }

    pub fn biome(&mut self, x: i32, y: i32, z: i32) -> Res<Option<String>> {
        let Some(c) = self.chunk(x >> 4, z >> 4)? else { return Ok(None) };
        let Some(s) = c.sections.get(&(y >> 4)) else { return Ok(None) };
        if s.biome_palette.is_empty() {
            return Ok(None);
        }
        let i = ((((y & 15) >> 2) * 4 + ((z & 15) >> 2)) * 4 + ((x & 15) >> 2)) as usize;
        Ok(s.biome_palette.get(s.biomes[i] as usize).cloned())
    }

    /// Every chunk overlapping the box exists and has finished generating.
    pub fn all_generated(&mut self, min_cx: i32, min_cz: i32, max_cx: i32, max_cz: i32) -> Res<bool> {
        for cx in min_cx..=max_cx {
            for cz in min_cz..=max_cz {
                match self.chunk(cx, cz)? {
                    Some(c) if c.status == "full" || c.status.ends_with(":full") => {}
                    _ => return Ok(false),
                }
            }
        }
        Ok(true)
    }
}

/// A box of real blocks, the same shape as TerrainData in shared/types.ts.
pub struct Terrain {
    pub size_x: usize,
    pub size_y: usize,
    pub size_z: usize,
    pub origin: (i32, i32, i32),
    pub palette: Vec<BlockState>,
    /// Palette index per block, laid out x + z*sizeX + y*sizeX*sizeZ.
    pub blocks: Vec<u16>,
    pub biome_palette: Vec<String>,
    /// Biome palette index per column (x + z*sizeX), sampled at the column's surface.
    pub biomes: Vec<u16>,
    pub dimension: String,
}

impl Terrain {
    /// The binary form the window and the cache files use: header JSON + blocks + biomes (u16 little-endian).
    pub fn to_packed(&self) -> Vec<u8> {
        let head = json!({
            "sizeX": self.size_x, "sizeY": self.size_y, "sizeZ": self.size_z,
            "originX": self.origin.0, "originY": self.origin.1, "originZ": self.origin.2,
            "palette": self.palette, "biomePalette": self.biome_palette, "dimension": self.dimension
        });
        let head = serde_json::to_vec(&head).unwrap();
        let mut out = Vec::with_capacity(4 + head.len() + 2 * (self.blocks.len() + self.biomes.len()));
        out.extend_from_slice(&(head.len() as u32).to_le_bytes());
        out.extend_from_slice(&head);
        for v in self.blocks.iter().chain(self.biomes.iter()) {
            out.extend_from_slice(&v.to_le_bytes());
        }
        out
    }

    /// Checks that cached bytes are a whole terrain (a cut-off file is ignored).
    pub fn packed_is_valid(bytes: &[u8]) -> bool {
        let Some(len) = bytes.get(..4).map(|b| u32::from_le_bytes(b.try_into().unwrap()) as usize) else {
            return false;
        };
        let Some(head) = bytes.get(4..4 + len).and_then(|h| serde_json::from_slice::<serde_json::Value>(h).ok()) else {
            return false;
        };
        let n = |k: &str| head[k].as_u64().unwrap_or(0) as usize;
        bytes.len() == 4 + len + 2 * (n("sizeX") * n("sizeY") * n("sizeZ") + n("sizeX") * n("sizeZ"))
    }
}

pub struct ExtractOptions {
    pub center_x: i32,
    pub center_z: i32,
    pub size: usize,
    pub dimension: String,
    /// If set, take a vertical window around this Y (caves, the Nether). Otherwise follow the surface.
    pub focus_y: Option<i32>,
}

/// Cuts a box of real blocks out of the world.
pub fn extract_terrain(cache: &mut ChunkCache, o: &ExtractOptions) -> Res<Terrain> {
    let size = o.size;
    let x0 = (o.center_x as f64 - size as f64 / 2.0).floor() as i32;
    let z0 = (o.center_z as f64 - size as f64 / 2.0).floor() as i32;
    let min_world_y = if o.dimension == "overworld" { -64 } else { 0 };
    let max_world_y = if o.dimension == "overworld" { 319 } else { 255 };
    let mut surface = vec![min_world_y; size * size];
    let (y_min, y_max) = match o.focus_y {
        Some(fy) => {
            surface.iter_mut().for_each(|s| *s = fy);
            (min_world_y.max(fy - 16), max_world_y.min(fy + 24))
        }
        None => {
            let (mut lowest, mut highest) = (i32::MAX, i32::MIN);
            for dz in 0..size {
                for dx in 0..size {
                    let mut y = max_world_y;
                    while y > min_world_y {
                        let air = cache.block(x0 + dx as i32, y, z0 + dz as i32)?.is_none_or(|b| b.air);
                        if !air {
                            break;
                        }
                        y -= 1;
                    }
                    surface[dx + dz * size] = y;
                    lowest = lowest.min(y);
                    highest = highest.max(y);
                }
            }
            if lowest == i32::MAX {
                return Err("Area contains no blocks".into());
            }
            (min_world_y.max(lowest - 8), highest)
        }
    };
    let size_y = (y_max - y_min + 1).max(0) as usize;
    let mut palette = vec![BlockState { name: "minecraft:air".into(), properties: BTreeMap::new() }];
    let mut index: HashMap<String, u16> = HashMap::from([("minecraft:air".to_string(), 0)]);
    let mut blocks = vec![0u16; size * size * size_y];
    for dy in 0..size_y {
        for dz in 0..size {
            for dx in 0..size {
                let Some(b) = cache.block(x0 + dx as i32, y_min + dy as i32, z0 + dz as i32)? else { continue };
                if b.air {
                    continue;
                }
                let idx = match index.get(&b.key) {
                    Some(i) => *i,
                    None => {
                        let i = palette.len() as u16;
                        palette.push(b.state.clone());
                        index.insert(b.key.clone(), i);
                        i
                    }
                };
                blocks[dx + dz * size + dy * size * size] = idx;
            }
        }
    }
    let mut biome_palette: Vec<String> = Vec::new();
    let mut biome_index: HashMap<String, u16> = HashMap::new();
    let mut biomes = vec![0u16; size * size];
    for dz in 0..size {
        for dx in 0..size {
            let y = surface[dx + dz * size].clamp(y_min, y_max.max(y_min));
            let id = cache.biome(x0 + dx as i32, y, z0 + dz as i32)?.unwrap_or_else(|| "minecraft:plains".into());
            let idx = *biome_index.entry(id.clone()).or_insert_with(|| {
                biome_palette.push(id);
                (biome_palette.len() - 1) as u16
            });
            biomes[dx + dz * size] = idx;
        }
    }
    Ok(Terrain {
        size_x: size,
        size_y,
        size_z: size,
        origin: (x0, y_min, z0),
        palette,
        blocks,
        biome_palette,
        biomes,
        dimension: o.dimension.clone(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    // A tiny NBT writer for building test chunks.
    fn s(out: &mut Vec<u8>, t: &str) {
        out.extend_from_slice(&(t.len() as u16).to_be_bytes());
        out.extend_from_slice(t.as_bytes());
    }

    fn chunk_nbt(cx: i32, cz: i32, stone_below: i32) -> Vec<u8> {
        let mut o = vec![10];
        s(&mut o, "");
        o.push(3);
        s(&mut o, "xPos");
        o.extend_from_slice(&cx.to_be_bytes());
        o.push(3);
        s(&mut o, "zPos");
        o.extend_from_slice(&cz.to_be_bytes());
        o.push(8);
        s(&mut o, "Status");
        s(&mut o, "minecraft:full");
        o.push(9);
        s(&mut o, "sections");
        o.push(10);
        o.extend_from_slice(&1i32.to_be_bytes());
        // section Y=0: palette [air, stone, oak_stairs[facing=east]], 4 bits
        o.push(1);
        s(&mut o, "Y");
        o.push(0);
        o.push(10);
        s(&mut o, "block_states");
        o.push(9);
        s(&mut o, "palette");
        o.push(10);
        o.extend_from_slice(&3i32.to_be_bytes());
        for (name, prop) in [("minecraft:air", None), ("minecraft:stone", None), ("oak_stairs", Some(("facing", "east")))] {
            o.push(8);
            s(&mut o, "Name");
            s(&mut o, name);
            if let Some((k, v)) = prop {
                o.push(10);
                s(&mut o, "Properties");
                o.push(8);
                s(&mut o, k);
                s(&mut o, v);
                o.push(0);
            }
            o.push(0);
        }
        // data: 4096 entries at 4 bits = 256 longs
        let mut idx = vec![0u64; 4096];
        for y in 0..16usize {
            for z in 0..16usize {
                for x in 0..16usize {
                    let y32 = y as i32;
                    let v = if y32 < stone_below { 1 } else if y32 == stone_below && x == 0 && z == 0 { 2 } else { 0 };
                    idx[(y * 16 + z) * 16 + x] = v;
                }
            }
        }
        o.push(12);
        s(&mut o, "data");
        o.extend_from_slice(&256i32.to_be_bytes());
        for l in 0..256 {
            let mut v = 0u64;
            for k in 0..16 {
                v |= idx[l * 16 + k] << (k * 4);
            }
            o.extend_from_slice(&(v as i64).to_be_bytes());
        }
        o.push(0); // end block_states
        o.push(10);
        s(&mut o, "biomes");
        o.push(9);
        s(&mut o, "palette");
        o.push(8);
        o.extend_from_slice(&1i32.to_be_bytes());
        s(&mut o, "minecraft:desert");
        o.push(0); // end biomes
        o.push(0); // end section
        o.push(0); // end root
        o
    }

    fn region_with(chunks: &[(i32, i32, Vec<u8>)]) -> Vec<u8> {
        use std::io::Write;
        let mut header = vec![0u8; 8192];
        let mut body = Vec::new();
        for (lx, lz, nbt) in chunks {
            let mut z = flate2::write::ZlibEncoder::new(Vec::new(), flate2::Compression::fast());
            z.write_all(nbt).unwrap();
            let data = z.finish().unwrap();
            let sector = 2 + body.len() / SECTOR;
            let mut rec = ((data.len() + 1) as u32).to_be_bytes().to_vec();
            rec.push(2);
            rec.extend_from_slice(&data);
            let sectors = rec.len().div_ceil(SECTOR);
            rec.resize(sectors * SECTOR, 0);
            let i = 4 * (lx + lz * 32) as usize;
            header[i..i + 3].copy_from_slice(&(sector as u32).to_be_bytes()[1..]);
            header[i + 3] = sectors as u8;
            body.extend_from_slice(&rec);
        }
        header.extend_from_slice(&body);
        header
    }

    #[test]
    fn extracts_a_box() {
        let chunks: Vec<_> = (0..2).flat_map(|x| (0..2).map(move |z| (x, z, chunk_nbt(x, z, 5)))).collect();
        let region = region_with(&chunks);
        let mut cache = ChunkCache::new(Box::new(move |rx, rz| (rx == 0 && rz == 0).then(|| region.clone())));
        assert!(cache.all_generated(0, 0, 1, 1).unwrap());
        assert!(!cache.all_generated(0, 0, 2, 1).unwrap());
        let t = extract_terrain(
            &mut cache,
            &ExtractOptions { center_x: 16, center_z: 16, size: 8, dimension: "overworld".into(), focus_y: None },
        )
        .unwrap();
        assert_eq!((t.size_x, t.size_z), (8, 8));
        assert_eq!(t.origin, (12, -4, 12)); // lowest surface y=4, minus 8 blocks of ground
        assert_eq!(t.palette[1].name, "minecraft:stone");
        assert_eq!(t.biome_palette, vec!["minecraft:desert".to_string()]);
        // The stair at (16, 5, 16) is the highest block there.
        assert!(t.palette.iter().any(|p| p.name == "minecraft:oak_stairs" && p.properties["facing"] == "east"));
        assert!(Terrain::packed_is_valid(&t.to_packed()));
    }

    #[test]
    fn unpacks_like_the_ts_version() {
        let data = [0x0123_4567_89ab_cdefu64 as i64];
        assert_eq!(&unpack_paletted_indices(Some(&data), 4, 16)[..4], &[0xf, 0xe, 0xd, 0xc]);
        assert_eq!(parse_block_string("oak_stairs[facing=north, half=top]").key(), "minecraft:oak_stairs[facing=north,half=top]");
    }
}
