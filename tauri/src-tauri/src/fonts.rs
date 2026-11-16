// Fonts installed on this computer, for title text. Only each file's name table is read while listing; a font's
// bytes are read when it is picked (the window then embeds them in the project). Port of shared/fontFiles.ts.
use serde::Serialize;
use std::collections::{HashMap, HashSet};
use std::fs;
use std::io::{Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use crate::util::{err, Res};

#[derive(Serialize, Clone)]
pub struct SystemFont {
    family: String,
    style: String,
    full: String,
    path: String,
    index: usize,
}

const SFNT: [u32; 3] = [0x0001_0000, 0x4f54_544f, 0x7472_7565];
const TTCF: u32 = 0x7474_6366;

fn be32(b: &[u8], at: usize) -> Option<u32> {
    b.get(at..at + 4).map(|s| u32::from_be_bytes(s.try_into().unwrap()))
}
fn be16(b: &[u8], at: usize) -> Option<u16> {
    b.get(at..at + 2).map(|s| u16::from_be_bytes(s.try_into().unwrap()))
}

/// Offsets of each font in a file: one for a .ttf/.otf, several for a .ttc collection; empty if not a font.
pub fn font_offsets(head: &[u8]) -> Vec<u32> {
    let Some(tag) = be32(head, 0) else { return vec![] };
    if SFNT.contains(&tag) {
        return vec![0];
    }
    if tag != TTCF {
        return vec![];
    }
    let n = be32(head, 8).unwrap_or(0).min(64) as usize;
    (0..n).map_while(|i| be32(head, 12 + i * 4)).collect()
}

/// Reads `len` bytes at `at` of an open file.
fn read_at(f: &mut fs::File, size: u64, at: u64, len: usize) -> Vec<u8> {
    let len = len.min(size.saturating_sub(at) as usize);
    let mut buf = vec![0; len];
    if len > 0 && f.seek(SeekFrom::Start(at)).is_ok() && f.read_exact(&mut buf).is_ok() {
        buf
    } else {
        vec![]
    }
}

/// Family, style and full name of the font at `offset`, or None when it has no usable name table.
fn font_name(f: &mut fs::File, size: u64, offset: u64) -> Option<(String, String, String)> {
    let count = be16(&read_at(f, size, offset + 4, 2), 0)? as usize;
    let dir = read_at(f, size, offset + 12, count * 16);
    let mut name_table = None;
    for i in 0..count {
        let r = i * 16;
        if dir.get(r..r + 4) == Some(b"name") {
            name_table = Some((be32(&dir, r + 8)?, be32(&dir, r + 12)?));
        }
    }
    let (t_off, t_len) = name_table?;
    if t_len > 1 << 20 {
        return None;
    }
    let dv = read_at(f, size, t_off as u64, t_len as usize);
    let count = be16(&dv, 2)? as usize;
    let strings = be16(&dv, 4)? as usize;
    // Best record per name id: Windows English Unicode, then any Windows Unicode, then Mac Roman.
    let mut best: HashMap<u16, (i32, String)> = HashMap::new();
    for i in 0..count {
        let r = 6 + i * 12;
        let (Some(platform), Some(encoding), Some(lang), Some(id), Some(len), Some(rel)) =
            (be16(&dv, r), be16(&dv, r + 2), be16(&dv, r + 4), be16(&dv, r + 6), be16(&dv, r + 8), be16(&dv, r + 10))
        else {
            break;
        };
        if ![1, 2, 4, 16, 17].contains(&id) {
            continue;
        }
        let at = strings + rel as usize;
        let Some(raw) = dv.get(at..at + len as usize) else { continue };
        let utf16 = |raw: &[u8]| {
            let units: Vec<u16> = raw.chunks_exact(2).map(|c| u16::from_be_bytes([c[0], c[1]])).collect();
            String::from_utf16_lossy(&units)
        };
        let (text, score) = if platform == 3 && (encoding == 1 || encoding == 10) {
            (utf16(raw), if lang == 0x409 { 3 } else { 2 })
        } else if platform == 0 {
            (utf16(raw), 2)
        } else if platform == 1 && encoding == 0 {
            (raw.iter().map(|b| *b as char).collect(), 1)
        } else {
            continue;
        };
        let text = text.replace('\0', "").trim().to_string();
        if !text.is_empty() && best.get(&id).map(|b| b.0).unwrap_or(-1) < score {
            best.insert(id, (score, text));
        }
    }
    let get = |id: u16| best.get(&id).map(|b| b.1.clone());
    let family = get(16).or_else(|| get(1))?;
    let style = get(17).or_else(|| get(2)).unwrap_or_else(|| "Regular".into());
    let full = get(4).unwrap_or_else(|| if style == "Regular" { family.clone() } else { format!("{family} {style}") });
    Some((family, style, full))
}

fn font_dirs() -> Vec<PathBuf> {
    let home = dirs::home_dir().unwrap_or_default();
    if cfg!(windows) {
        let win = std::env::var("WINDIR").unwrap_or_else(|_| "C:\\Windows".into());
        let local = dirs::data_local_dir().unwrap_or_else(|| home.join("AppData/Local"));
        vec![Path::new(&win).join("Fonts"), local.join("Microsoft/Windows/Fonts")]
    } else if cfg!(target_os = "macos") {
        vec!["/System/Library/Fonts".into(), "/Library/Fonts".into(), home.join("Library/Fonts")]
    } else {
        vec!["/usr/share/fonts".into(), "/usr/local/share/fonts".into(), home.join(".local/share/fonts"), home.join(".fonts")]
    }
}

fn walk(dir: &Path, depth: u32, out: &mut Vec<PathBuf>) {
    if depth > 4 {
        return;
    }
    let Ok(rd) = fs::read_dir(dir) else { return };
    for e in rd.flatten() {
        let p = e.path();
        if p.is_dir() {
            walk(&p, depth + 1, out);
        } else if p
            .extension()
            .and_then(|x| x.to_str())
            .is_some_and(|x| ["ttf", "otf", "ttc"].contains(&x.to_lowercase().as_str()))
        {
            out.push(p);
        }
    }
}

static LISTED: Mutex<Option<Vec<SystemFont>>> = Mutex::new(None);

/// Every installed font (each face of a collection separately), sorted by name. Listed once per app run.
pub fn list() -> Vec<SystemFont> {
    if let Some(l) = LISTED.lock().unwrap().as_ref() {
        return l.clone();
    }
    let mut files = Vec::new();
    for d in font_dirs() {
        walk(&d, 0, &mut files);
    }
    let mut seen = HashSet::new();
    let mut out = Vec::new();
    for path in files {
        let Ok(mut f) = fs::File::open(&path) else { continue };
        let size = f.metadata().map(|m| m.len()).unwrap_or(0);
        let head = read_at(&mut f, size, 0, 12 + 64 * 4);
        for (index, offset) in font_offsets(&head).into_iter().enumerate() {
            let Some((family, style, full)) = font_name(&mut f, size, offset as u64) else { continue };
            if family.starts_with('.') || !seen.insert(full.clone()) {
                continue;
            }
            out.push(SystemFont { family, style, full, path: path.to_string_lossy().into(), index });
        }
    }
    out.sort_by(|a, b| a.family.to_lowercase().cmp(&b.family.to_lowercase()).then(a.style.cmp(&b.style)));
    *LISTED.lock().unwrap() = Some(out.clone());
    out
}

/// One font of a collection as a standalone .ttf/.otf (browsers can't load a .ttc as a web font).
pub fn extract_font(bytes: &[u8], offset: usize) -> Res<Vec<u8>> {
    let bad = || "That font file is damaged".to_string();
    if offset == 0 && be32(bytes, 0).is_some_and(|t| SFNT.contains(&t)) {
        return Ok(bytes.to_vec());
    }
    let count = be16(bytes, offset + 4).ok_or_else(bad)? as usize;
    let pad = |n: usize| (n + 3) & !3;
    let mut records = Vec::new();
    for i in 0..count {
        let r = offset + 12 + i * 16;
        let rec = bytes.get(r..r + 16).ok_or_else(bad)?;
        records.push((rec, be32(bytes, r + 8).ok_or_else(bad)? as usize, be32(bytes, r + 12).ok_or_else(bad)? as usize));
    }
    let head = 12 + count * 16;
    let total = records.iter().fold(head, |s, t| s + pad(t.2));
    let mut out = vec![0u8; total];
    out[..12].copy_from_slice(bytes.get(offset..offset + 12).ok_or_else(bad)?);
    let mut at = head;
    for (i, (rec, t_off, t_len)) in records.iter().enumerate() {
        let r = 12 + i * 16;
        out[r..r + 16].copy_from_slice(rec);
        out[r + 8..r + 12].copy_from_slice(&(at as u32).to_be_bytes());
        out[at..at + t_len].copy_from_slice(bytes.get(*t_off..t_off + t_len).ok_or_else(bad)?);
        at += pad(*t_len);
    }
    Ok(out)
}

/// A listed font's bytes as a standalone .ttf/.otf. Only files the list itself found, so the window can't read
/// arbitrary files through this.
pub fn read(path: &str, index: usize) -> Res<Vec<u8>> {
    if !list().iter().any(|f| f.path == path && f.index == index) {
        return Err("That font is no longer installed".into());
    }
    let bytes = fs::read(path).map_err(err)?;
    let offset = *font_offsets(&bytes).get(index).unwrap_or(&0) as usize;
    extract_font(&bytes, offset)
}
