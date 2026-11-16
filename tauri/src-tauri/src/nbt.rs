// Minimal big-endian NBT reader (Java Edition format), enough for Anvil chunk data (port of nbt.ts).
use std::collections::HashMap;
use std::io::Read;

use crate::util::Res;

#[derive(Debug, Clone)]
pub enum Nbt {
    Byte(i8),
    Short(i16),
    Int(i32),
    Long(i64),
    Float(f32),
    Double(f64),
    ByteArray(Vec<i8>),
    Str(String),
    List(Vec<Nbt>),
    Compound(HashMap<String, Nbt>),
    IntArray(Vec<i32>),
    LongArray(Vec<i64>),
}

impl Nbt {
    pub fn compound(&self) -> Option<&HashMap<String, Nbt>> {
        match self {
            Nbt::Compound(c) => Some(c),
            _ => None,
        }
    }
    pub fn get(&self, key: &str) -> Option<&Nbt> {
        self.compound()?.get(key)
    }
    pub fn list(&self) -> Option<&[Nbt]> {
        match self {
            Nbt::List(l) => Some(l),
            _ => None,
        }
    }
    pub fn as_f64(&self) -> Option<f64> {
        Some(match self {
            Nbt::Byte(v) => *v as f64,
            Nbt::Short(v) => *v as f64,
            Nbt::Int(v) => *v as f64,
            Nbt::Long(v) => *v as f64,
            Nbt::Float(v) => *v as f64,
            Nbt::Double(v) => *v,
            Nbt::Str(s) => s.trim().parse().ok()?,
            _ => return None,
        })
    }
    /// Like JavaScript's String(value), for property values and ids.
    pub fn to_js_string(&self) -> String {
        match self {
            Nbt::Str(s) => s.clone(),
            Nbt::Byte(v) => v.to_string(),
            Nbt::Short(v) => v.to_string(),
            Nbt::Int(v) => v.to_string(),
            Nbt::Long(v) => v.to_string(),
            Nbt::Float(v) => v.to_string(),
            Nbt::Double(v) => v.to_string(),
            Nbt::Compound(_) => "[object Object]".into(),
            Nbt::List(l) => l.iter().map(Nbt::to_js_string).collect::<Vec<_>>().join(","),
            Nbt::ByteArray(a) => a.iter().map(|v| v.to_string()).collect::<Vec<_>>().join(","),
            Nbt::IntArray(a) => a.iter().map(|v| v.to_string()).collect::<Vec<_>>().join(","),
            Nbt::LongArray(a) => a.iter().map(|v| v.to_string()).collect::<Vec<_>>().join(","),
        }
    }
}

struct Reader<'a> {
    b: &'a [u8],
    pos: usize,
}

impl Reader<'_> {
    fn corrupt(&self) -> String {
        format!("Truncated or corrupt NBT at offset {}", self.pos)
    }
    fn take(&mut self, n: usize) -> Res<&[u8]> {
        if self.pos + n > self.b.len() {
            return Err(self.corrupt());
        }
        let s = &self.b[self.pos..self.pos + n];
        self.pos += n;
        Ok(s)
    }
    fn u8(&mut self) -> Res<u8> {
        Ok(self.take(1)?[0])
    }
    fn i16(&mut self) -> Res<i16> {
        Ok(i16::from_be_bytes(self.take(2)?.try_into().unwrap()))
    }
    fn u16(&mut self) -> Res<u16> {
        Ok(u16::from_be_bytes(self.take(2)?.try_into().unwrap()))
    }
    fn i32(&mut self) -> Res<i32> {
        Ok(i32::from_be_bytes(self.take(4)?.try_into().unwrap()))
    }
    fn i64(&mut self) -> Res<i64> {
        Ok(i64::from_be_bytes(self.take(8)?.try_into().unwrap()))
    }
    fn len(&mut self, each: usize) -> Res<usize> {
        let n = self.i32()?;
        if n < 0 {
            return Ok(0);
        }
        let n = n as usize;
        if self.pos + n.saturating_mul(each.max(1)) > self.b.len() {
            return Err(self.corrupt());
        }
        Ok(n)
    }
    fn str(&mut self) -> Res<String> {
        let n = self.u16()? as usize;
        Ok(String::from_utf8_lossy(self.take(n)?).into_owned())
    }
    fn payload(&mut self, t: u8, depth: u32) -> Res<Nbt> {
        if depth > 512 {
            return Err("NBT nested too deeply".into());
        }
        Ok(match t {
            1 => Nbt::Byte(self.u8()? as i8),
            2 => Nbt::Short(self.i16()?),
            3 => Nbt::Int(self.i32()?),
            4 => Nbt::Long(self.i64()?),
            5 => Nbt::Float(f32::from_bits(self.i32()? as u32)),
            6 => Nbt::Double(f64::from_bits(self.i64()? as u64)),
            7 => {
                let n = self.len(1)?;
                Nbt::ByteArray(self.take(n)?.iter().map(|b| *b as i8).collect())
            }
            8 => Nbt::Str(self.str()?),
            9 => {
                let item = self.u8()?;
                let n = self.len(1)?;
                if n > 0 && item == 0 {
                    return Err(format!("Corrupt NBT list at offset {}", self.pos));
                }
                let mut out = Vec::with_capacity(n);
                for _ in 0..n {
                    out.push(self.payload(item, depth + 1)?);
                }
                // 1.21.5+ lists may mix types: then every non-compound item is written as a compound whose only
                // key is the empty name. Unwrap them so a palette reads as plain strings and compounds again.
                if item == 10 {
                    for v in out.iter_mut() {
                        if let Nbt::Compound(c) = v {
                            if c.len() == 1 && c.contains_key("") {
                                *v = c.remove("").unwrap();
                            }
                        }
                    }
                }
                Nbt::List(out)
            }
            10 => {
                let mut out = HashMap::new();
                loop {
                    let t = self.u8()?;
                    if t == 0 {
                        break;
                    }
                    let name = self.str()?;
                    let v = self.payload(t, depth + 1)?;
                    out.insert(name, v);
                }
                Nbt::Compound(out)
            }
            11 => {
                let n = self.len(4)?;
                let mut out = Vec::with_capacity(n);
                for _ in 0..n {
                    out.push(self.i32()?);
                }
                Nbt::IntArray(out)
            }
            12 => {
                let n = self.len(8)?;
                let mut out = Vec::with_capacity(n);
                for _ in 0..n {
                    out.push(self.i64()?);
                }
                Nbt::LongArray(out)
            }
            _ => return Err(format!("Unknown NBT tag type {t} at offset {}", self.pos)),
        })
    }
}

/// Parses an uncompressed NBT document and returns its root compound.
pub fn parse(bytes: &[u8]) -> Res<Nbt> {
    let mut r = Reader { b: bytes, pos: 0 };
    if r.u8()? != 10 {
        return Err("NBT root is not a compound".into());
    }
    r.str()?;
    r.payload(10, 0)
}

/// Inflates gzip or zlib data, giving up as soon as the output passes `max` bytes.
pub fn inflate_capped(bytes: &[u8], gzip: bool, max: usize) -> Res<Vec<u8>> {
    let mut out = Vec::new();
    let reader: Box<dyn Read> = if gzip {
        Box::new(flate2::read::GzDecoder::new(bytes))
    } else {
        Box::new(flate2::read::ZlibDecoder::new(bytes))
    };
    reader.take(max as u64 + 1).read_to_end(&mut out).map_err(|e| format!("Corrupt compressed data ({e})"))?;
    if out.len() > max {
        return Err(format!("File unpacks to more than {} MB; it is too large or corrupt", max >> 20));
    }
    Ok(out)
}
