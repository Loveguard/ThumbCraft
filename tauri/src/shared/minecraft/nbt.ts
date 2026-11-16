// Minimal big-endian NBT reader (Java Edition format), enough for Anvil chunk data.

export type NbtValue = number | bigint | string | Int8Array | Int32Array | BigInt64Array | NbtValue[] | NbtCompound

export interface NbtCompound {
  [key: string]: NbtValue
}

const TAG_END = 0
const TAG_BYTE = 1
const TAG_SHORT = 2
const TAG_INT = 3
const TAG_LONG = 4
const TAG_FLOAT = 5
const TAG_DOUBLE = 6
const TAG_BYTE_ARRAY = 7
const TAG_STRING = 8
const TAG_LIST = 9
const TAG_COMPOUND = 10
const TAG_INT_ARRAY = 11
const TAG_LONG_ARRAY = 12

const decoder = new TextDecoder('utf-8')

class Reader {
  private view: DataView
  pos = 0
  constructor(readonly bytes: Uint8Array) {
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  }
  /** Fails cleanly (instead of allocating gigabytes or reading past the end) on corrupt lengths. */
  need(n: number): void {
    if (!(n >= 0) || this.pos + n > this.bytes.length) throw new Error(`Truncated or corrupt NBT at offset ${this.pos}`)
  }
  u8(): number {
    return this.view.getUint8(this.pos++)
  }
  i8(): number {
    return this.view.getInt8(this.pos++)
  }
  i16(): number {
    const v = this.view.getInt16(this.pos)
    this.pos += 2
    return v
  }
  u16(): number {
    const v = this.view.getUint16(this.pos)
    this.pos += 2
    return v
  }
  i32(): number {
    const v = this.view.getInt32(this.pos)
    this.pos += 4
    return v
  }
  i64(): bigint {
    const v = this.view.getBigInt64(this.pos)
    this.pos += 8
    return v
  }
  f32(): number {
    const v = this.view.getFloat32(this.pos)
    this.pos += 4
    return v
  }
  f64(): number {
    const v = this.view.getFloat64(this.pos)
    this.pos += 8
    return v
  }
  // Java's "modified UTF-8" only differs from UTF-8 for NUL and supplementary chars,
  // which don't occur in block/biome ids.
  str(): string {
    const len = this.u16()
    this.need(len)
    const s = decoder.decode(this.bytes.subarray(this.pos, this.pos + len))
    this.pos += len
    return s
  }
}

function readPayload(r: Reader, type: number): NbtValue {
  switch (type) {
    case TAG_BYTE:
      return r.i8()
    case TAG_SHORT:
      return r.i16()
    case TAG_INT:
      return r.i32()
    case TAG_LONG:
      return r.i64()
    case TAG_FLOAT:
      return r.f32()
    case TAG_DOUBLE:
      return r.f64()
    case TAG_BYTE_ARRAY: {
      const n = r.i32()
      r.need(n)
      const out = new Int8Array(r.bytes.slice(r.pos, r.pos + n).buffer)
      r.pos += n
      return out
    }
    case TAG_STRING:
      return r.str()
    case TAG_LIST: {
      const itemType = r.u8()
      const n = r.i32()
      if (n > 0 && itemType === TAG_END) throw new Error(`Corrupt NBT list at offset ${r.pos}`)
      r.need(Math.max(0, n)) // every element takes at least one byte
      const out: NbtValue[] = []
      for (let i = 0; i < n; i++) out.push(readPayload(r, itemType))
      // 1.21.5+ lists may mix types: then every non-compound item is written as a compound whose only
      // key is the empty name. Unwrap them so a palette reads as plain strings and compounds again.
      if (itemType === TAG_COMPOUND)
        for (let i = 0; i < out.length; i++) {
          const c = out[i] as NbtCompound
          const keys = Object.keys(c)
          if (keys.length === 1 && keys[0] === '') out[i] = c['']
        }
      return out
    }
    case TAG_COMPOUND: {
      const out: NbtCompound = {}
      for (;;) {
        const t = r.u8()
        if (t === TAG_END) break
        const name = r.str()
        const value = readPayload(r, t)
        // A crafted file must not be able to swap a compound's prototype.
        if (name !== '__proto__') out[name] = value
      }
      return out
    }
    case TAG_INT_ARRAY: {
      const n = r.i32()
      r.need(n * 4)
      const out = new Int32Array(n)
      for (let i = 0; i < n; i++) out[i] = r.i32()
      return out
    }
    case TAG_LONG_ARRAY: {
      const n = r.i32()
      r.need(n * 8)
      const out = new BigInt64Array(n)
      for (let i = 0; i < n; i++) out[i] = r.i64()
      return out
    }
    default:
      throw new Error(`Unknown NBT tag type ${type} at offset ${r.pos}`)
  }
}

/** Parses an uncompressed NBT document and returns its root compound. */
export function parseNbt(bytes: Uint8Array): NbtCompound {
  const r = new Reader(bytes)
  try {
    const type = r.u8()
    if (type !== TAG_COMPOUND) throw new Error('NBT root is not a compound')
    r.str() // root name, usually empty
    return readPayload(r, TAG_COMPOUND) as NbtCompound
  } catch (e) {
    // DataView reads past the end throw a bare RangeError; say what actually happened.
    if (e instanceof RangeError) throw new Error(`Truncated or corrupt NBT at offset ${r.pos}`)
    throw e
  }
}
