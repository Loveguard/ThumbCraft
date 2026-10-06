// java.util.Random, bit for bit: vanilla seeds some visuals (the lightning bolt's shape) with it.
const MULT = 0x5deece66dn
const MASK = (1n << 48n) - 1n

export class JavaRandom {
  private seed: bigint

  constructor(seed: number | bigint) {
    this.seed = (BigInt.asIntN(64, BigInt(seed)) ^ MULT) & MASK
  }

  private next(bits: number): number {
    this.seed = (this.seed * MULT + 0xbn) & MASK
    return Number(BigInt.asIntN(32, this.seed >> BigInt(48 - bits)))
  }

  nextInt(bound?: number): number {
    if (bound === undefined) return this.next(32)
    if (bound <= 0) throw new RangeError('bound must be positive')
    if ((bound & -bound) === bound) return Number((BigInt(bound) * BigInt(this.next(31))) >> 31n)
    let bits: number
    let val: number
    do {
      bits = this.next(31)
      val = bits % bound
    } while (bits - val + (bound - 1) > 0x7fffffff)
    return val
  }
}
