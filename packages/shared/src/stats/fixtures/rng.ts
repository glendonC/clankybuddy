// Tiny deterministic PRNG. Mulberry32 is fine for demo data, uniform
// enough for synthetic distributions, fast, and a single seed yields a
// reproducible stream. Do NOT use this for anything security-adjacent;
// it's a UI fixture generator, nothing more.

export type Rng = {
  // Uniform float in [0, 1).
  next(): number;
  // Integer in [min, max] inclusive.
  intBetween(min: number, max: number): number;
  // Float in [min, max).
  floatBetween(min: number, max: number): number;
  // True with probability p.
  chance(p: number): boolean;
  // Pick a uniform element from a non-empty array.
  pick<T>(arr: readonly T[]): T;
  // Pick weighted by `weights[i]`. weights and items must have equal
  // length; weights need not sum to 1.
  weightedPick<T>(arr: readonly T[], weights: readonly number[]): T;
  // Fork a child RNG using a string salt. The same parent seed + salt
  // always forks to the same stream, lets us split sub-streams by
  // concern (`'stats'`, `'chat'`) without one block of work changing
  // the other's output.
  fork(salt: string): Rng;
};

export function makeRng(seed: number): Rng {
  let s = seed >>> 0;
  function next(): number {
    s = (s + 0x6D2B79F5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  return makeFromNext(next, seed);
}

function makeFromNext(next: () => number, seed: number): Rng {
  return {
    next,
    intBetween(min, max) {
      if (max < min) return min;
      return Math.floor(next() * (max - min + 1)) + min;
    },
    floatBetween(min, max) {
      return next() * (max - min) + min;
    },
    chance(p) {
      return next() < p;
    },
    pick(arr) {
      const i = Math.floor(next() * arr.length);
      return arr[i] as (typeof arr)[number];
    },
    weightedPick(arr, weights) {
      const sum = weights.reduce((a, b) => a + b, 0);
      if (sum <= 0) return arr[0] as (typeof arr)[number];
      let r = next() * sum;
      for (let i = 0; i < arr.length; i++) {
        r -= weights[i] ?? 0;
        if (r <= 0) return arr[i] as (typeof arr)[number];
      }
      return arr[arr.length - 1] as (typeof arr)[number];
    },
    fork(salt) {
      let h = seed >>> 0;
      for (let i = 0; i < salt.length; i++) {
        h = Math.imul(h ^ salt.charCodeAt(i), 0x01000193) >>> 0;
      }
      return makeRng(h);
    },
  };
}
