// Gerador determinístico de números pseudoaleatórios (Mulberry32 e SplitMix32)
export class PRNG {
  private state: number;

  constructor(seed: number | string = 1337) {
    this.state = typeof seed === 'string' ? PRNG.hashString(seed) : seed;
    if (this.state === 0) this.state = 1;
  }

  public static hashString(str: string): number {
    let hash = 2166136261;
    for (let i = 0; i < str.length; i++) {
      hash ^= str.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
  }

  public static hash2D(x: number, y: number, seed: number = 0): number {
    let h = seed + Math.imul(x, 374761393) + Math.imul(y, 668265263);
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  }

  public next(): number {
    let t = (this.state += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  public range(min: number, max: number): number {
    return min + this.next() * (max - min);
  }

  public rangeInt(min: number, max: number): number {
    return Math.floor(this.range(min, max + 1));
  }

  public chance(probability: number): boolean {
    return this.next() < probability;
  }
}
