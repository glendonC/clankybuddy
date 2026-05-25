// Per-RoomDO revocation bloom filter (backend-plan.md TUI threat model:
// "≤60s revocation propagation via per-RoomDO bloom filter sourced from
// DatabaseDO"). 1024 bits / 4 hashes / ≤200 expected items keeps the
// false-positive rate < 1%, the math:
//
//   FPR ≈ (1 - e^(-k·n/m))^k   with m=1024, k=4, n=200
//        ≈ (1 - e^(-0.781))^4
//        ≈ (0.5424)^4
//        ≈ 0.087  ← worst case, 200 entries
//
// At more typical n≈50 the FPR drops below 0.05%. The TUI plan accepts ≤1%
// because we cross-check against DatabaseDO before disconnecting on a hit
// (false positive becomes a single redundant DB read, not a bad disconnect).
//
// On-the-wire format: a Uint8Array of length BLOOM_BYTES. Encoded as base64
// when shipped over RPC for ergonomics; reconstituted on the consumer side.

export const BLOOM_BITS = 1024;
export const BLOOM_BYTES = BLOOM_BITS / 8;
export const BLOOM_HASHES = 4;

export interface RevocationBloom {
  bits: Uint8Array;
  // Generation counter so a RoomDO can fast-skip a refresh that hasn't
  // produced a new filter since the last fetch.
  generation: number;
}

export function emptyBloom(): RevocationBloom {
  return { bits: new Uint8Array(BLOOM_BYTES), generation: 0 };
}

// FNV-1a 32-bit. Cheap, well-distributed, no crypto needs (the bloom filter
// only sees user_ids that are public to the RoomDO already).
function fnv1a(s: string, seed: number): number {
  let h = (2166136261 ^ seed) >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

function indices(userId: string): number[] {
  const out: number[] = new Array<number>(BLOOM_HASHES);
  for (let k = 0; k < BLOOM_HASHES; k++) {
    out[k] = fnv1a(userId, k * 0x9e3779b1) % BLOOM_BITS;
  }
  return out;
}

export function bloomAdd(b: RevocationBloom, userId: string): void {
  for (const idx of indices(userId)) {
    const byte = idx >>> 3;
    const bit = idx & 7;
    b.bits[byte]! |= 1 << bit;
  }
}

export function bloomMightContain(b: RevocationBloom, userId: string): boolean {
  for (const idx of indices(userId)) {
    const byte = idx >>> 3;
    const bit = idx & 7;
    if ((b.bits[byte]! & (1 << bit)) === 0) return false;
  }
  return true;
}

export function bloomToBase64(b: RevocationBloom): string {
  let s = '';
  for (let i = 0; i < b.bits.length; i++) s += String.fromCharCode(b.bits[i]!);
  return btoa(s);
}

export function bloomFromBase64(encoded: string, generation: number): RevocationBloom {
  const raw = atob(encoded);
  const bits = new Uint8Array(BLOOM_BYTES);
  const len = Math.min(raw.length, BLOOM_BYTES);
  for (let i = 0; i < len; i++) bits[i] = raw.charCodeAt(i);
  return { bits, generation };
}

export function buildBloom(userIds: Iterable<string>): RevocationBloom {
  const b = emptyBloom();
  let gen = 0;
  for (const id of userIds) {
    bloomAdd(b, id);
    gen++;
  }
  b.generation = gen;
  return b;
}
