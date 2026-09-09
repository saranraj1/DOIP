/** Deterministic PRNG — same seed always produces the same run. */
export function mulberry32(seed: number) {
  let a = seed >>> 0;
  return function next() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export type Rand = () => number;

export const pick = <T,>(rand: Rand, arr: readonly T[]): T =>
  arr[Math.floor(rand() * arr.length)]!;

export const between = (rand: Rand, a: number, b: number) => a + rand() * (b - a);
