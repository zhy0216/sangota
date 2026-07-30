/**
 * Seeded RNG (mulberry32). A run's whole map is derived from one seed, so a
 * seed string is enough to reproduce a layout exactly — useful for debugging
 * and for daily-run style modes later.
 */
export class Rng {
  private state: number;

  constructor(seed: number | string) {
    this.state = typeof seed === 'number' ? seed >>> 0 : Rng.hash(seed);
  }

  static hash(str: string): number {
    let h = 2166136261 >>> 0;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }

  /**
   * The generator's cursor. Save/resume and the headless sim both need to park
   * a stream mid-run and pick it back up bit-for-bit.
   */
  getState(): number {
    return this.state;
  }

  fromState(state: number): void {
    this.state = state >>> 0;
  }

  /** [0, 1) */
  next(): number {
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** [0, max) */
  int(max: number): number {
    return Math.floor(this.next() * max);
  }

  /** [min, max] inclusive */
  range(min: number, max: number): number {
    return min + this.int(max - min + 1);
  }

  /** [-spread, +spread] as a float */
  jitter(spread: number): number {
    return (this.next() * 2 - 1) * spread;
  }

  pick<T>(items: readonly T[]): T {
    return items[this.int(items.length)];
  }

  /** Weighted pick. `weights` must line up with `items` and sum to > 0. */
  weighted<T>(items: readonly T[], weights: readonly number[]): T {
    const total = weights.reduce((a, b) => a + b, 0);
    let roll = this.next() * total;
    for (let i = 0; i < items.length; i++) {
      roll -= weights[i];
      if (roll <= 0) return items[i];
    }
    return items[items.length - 1];
  }

  shuffle<T>(items: T[]): T[] {
    for (let i = items.length - 1; i > 0; i--) {
      const j = this.int(i + 1);
      [items[i], items[j]] = [items[j], items[i]];
    }
    return items;
  }
}

/**
 * The single point of real entropy in the project. Everything downstream is
 * derived from the string this returns, so a run stays reproducible and the
 * headless sim can replay any fight from its seed alone.
 */
export function randomSeed(): string {
  const buf = new Uint32Array(1);
  crypto.getRandomValues(buf);
  return buf[0].toString(36);
}
