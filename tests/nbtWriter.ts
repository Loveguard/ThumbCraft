// NBT writer for tests: builds fixture region files and schematics.
const TAG_END = 0
const TAG_BYTE = 1
const TAG_SHORT = 2
const TAG_INT = 3
const TAG_LONG = 4
const TAG_FLOAT = 5
const TAG_DOUBLE = 6
const TAG_STRING = 8
const TAG_LIST = 9
const TAG_COMPOUND = 10
const TAG_LONG_ARRAY = 12

export type NbtTyped =
  | { type: 'byte' | 'short' | 'int' | 'float' | 'double'; value: number }
  | { type: 'long'; value: bigint }
  | { type: 'string'; value: string }
  | { type: 'longArray'; value: bigint[] }
  | { type: 'list'; itemType: number; value: NbtTyped[] }
  | { type: 'compound'; value: Record<string, NbtTyped> }

const typeIds: Record<NbtTyped['type'], number> = {
  byte: TAG_BYTE,
  short: TAG_SHORT,
  int: TAG_INT,
  long: TAG_LONG,
  float: TAG_FLOAT,
  double: TAG_DOUBLE,
  string: TAG_STRING,
  list: TAG_LIST,
  compound: TAG_COMPOUND,
  longArray: TAG_LONG_ARRAY
}

export const NBT_TAG = { compound: TAG_COMPOUND, string: TAG_STRING, end: TAG_END } as const

export function writeNbt(root: Record<string, NbtTyped>): Uint8Array {
  const out: number[] = []
  const enc = new TextEncoder()
  const u8 = (v: number): void => void out.push(v & 0xff)
  const i16 = (v: number): void => (u8(v >> 8), u8(v))
  const i32 = (v: number): void => (u8(v >> 24), u8(v >> 16), u8(v >> 8), u8(v))
  const i64 = (v: bigint): void => {
    const b = new DataView(new ArrayBuffer(8))
    b.setBigInt64(0, v)
    for (let i = 0; i < 8; i++) u8(b.getUint8(i))
  }
  const str = (s: string): void => {
    const b = enc.encode(s)
    i16(b.length)
    b.forEach(u8)
  }
  const payload = (t: NbtTyped): void => {
    switch (t.type) {
      case 'byte':
        return u8(t.value)
      case 'short':
        return i16(t.value)
      case 'int':
        return i32(t.value)
      case 'long':
        return i64(t.value)
      case 'float': {
        const b = new DataView(new ArrayBuffer(4))
        b.setFloat32(0, t.value)
        for (let i = 0; i < 4; i++) u8(b.getUint8(i))
        return
      }
      case 'double': {
        const b = new DataView(new ArrayBuffer(8))
        b.setFloat64(0, t.value)
        for (let i = 0; i < 8; i++) u8(b.getUint8(i))
        return
      }
      case 'string':
        return str(t.value)
      case 'longArray':
        i32(t.value.length)
        return t.value.forEach(i64)
      case 'list':
        u8(t.value.length ? typeIds[t.value[0].type] : t.itemType)
        i32(t.value.length)
        return t.value.forEach(payload)
      case 'compound':
        for (const [k, v] of Object.entries(t.value)) {
          u8(typeIds[v.type])
          str(k)
          payload(v)
        }
        return u8(TAG_END)
    }
  }
  u8(TAG_COMPOUND)
  str('')
  payload({ type: 'compound', value: root })
  return Uint8Array.from(out)
}
