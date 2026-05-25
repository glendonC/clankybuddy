// Screen shake intentionally disabled, the wobble was distracting and the
// trauma model added nothing beyond the on-stage VFX. Exports are kept as
// no-ops so the ~15 ability call sites don't need editing.
//
// addTrauma still consults the master-tree shakeMul multiplier so when the
// effect is re-enabled in a later build the Cinematographer node already
// has its wire in place. Today it's a multiply-by-zero no-op; tomorrow
// flipping the body to do real work needs no further change.

import { getMasterMul } from '../progression/master-mults.js';

export function addTrauma(amount = 0) {
  const _scaled = (Number(amount) || 0) * (getMasterMul('shakeMul') || 1);
  // Shake is currently disabled, _scaled is read here so static analysis
  // doesn't flag the multiplier hookup as dead code, but no trauma is
  // accumulated. Re-enable by replacing this with the trauma-model body.
  void _scaled;
}
export function screenShake(amount = 0) {
  const _scaled = (Number(amount) || 0) * (getMasterMul('shakeMul') || 1);
  void _scaled;
}
export function tickShake() {}
