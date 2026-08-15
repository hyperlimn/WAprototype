/** Small deterministic PRNG with string seed hashing. */
export class SeededRandom {
  private state: number;

  constructor(seed: string) {
    let hash = 2166136261;
    for (let i = 0; i < seed.length; i++) {
      hash ^= seed.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    this.state = hash >>> 0 || 1;
  }

  next(): number {
    let t = (this.state += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  range(min: number, max: number): number {
    return min + (max - min) * this.next();
  }

  hex(length: number): string {
    let value = "";
    while (value.length < length) value += Math.floor(this.next() * 0x100000000).toString(16).padStart(8, "0");
    return value.slice(0, length);
  }

  continuationState(): number { return this.state >>> 0; }
  restoreContinuationState(state: number): void {
    if (!Number.isInteger(state) || state < 0 || state > 0xffffffff) throw new Error("Invalid PRNG continuation state");
    this.state = state >>> 0;
  }
}
