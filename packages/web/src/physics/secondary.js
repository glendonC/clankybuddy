// Secondary-motion + hit-reaction helpers, the "make the buddy feel alive"
// layer that sits on top of stand.js. None of these add forces large enough to
// fight the user; they're bounded modulations on
// the existing orientation-pass blend rate and counter-gravity factor.
//
// Three techniques, named for their published references:
//
//   hitBlendScale , Unreal "Physical Animation Blend Weight" pattern (also
//                    documented in the Halo 2 / COD4 / Left 4 Dead "blended
//                    ragdoll" lineage). On impact, the affected part briefly
//                    drops out of the orientation pass, then ramps back over
//                    HIT_RECOVERY_MS via smoothstep. Punches read as punches
//                    instead of being snapped flat by the active stand-pose
//                    correction.
//
//   idleAngVelDelta, Per-part sine-sum pseudo-noise nudge applied each tick
//                    while the buddy is idle. The buddy stops looking dead
//                    at rest. Source: Palos Publishing secondary-motion
//                    guide; Wolfire/Overgrowth indie procedural animation.
//
//   breatheFactor  , Slow sine modulation of the counter-gravity multiplier
//                    so the chest visibly expands and contracts. ~18 bpm =
//                    0.3 Hz. ±1.8 % amplitude, subtle, not comical.
//
// Idle drift and breathing route through the existing blend-rate channel,
// which means hitBlendScale also gates them implicitly: a freshly-hit part
// has blend ≈ 0, so its idle drift does nothing during the recovery window.
// That's the desired interaction, limp parts shouldn't be wiggling.

export const HIT_RECOVERY_MS = 280;

export function markHit(part, now = performance.now()) {
  part._hitUntil = now + HIT_RECOVERY_MS;
}

// Returns 0..1 multiplier for the orientation-pass blend rate. Just after
// an impact: ~0 (full ragdoll at the hit site). At t = HIT_RECOVERY_MS: 1
// (full pose hold). Smoothstep keeps the recovery edge C¹-continuous so
// there's no visible "snap back" at the boundary.
export function hitBlendScale(part, now) {
  const until = part?._hitUntil;
  if (!until || now >= until) return 1;
  const remaining = (until - now) / HIT_RECOVERY_MS;
  const t = 1 - remaining;        // rises 0 → 1 as recovery progresses
  return t * t * (3 - 2 * t);     // smoothstep
}

// Sine-sum pseudo-noise at three octaves. Cheap, deterministic, and bounded
// in [-1, 1]. Real Perlin would be marginally smoother but adds a dep we
// don't need at this amplitude.
function pseudoNoise(t, phase) {
  return (
    Math.sin(t        + phase) +
    Math.sin(t * 1.7  + phase * 1.3) * 0.5 +
    Math.sin(t * 3.1  + phase * 2.1) * 0.25
  ) / 1.75;
}

// Per-part angular-velocity delta for idle motion. Seeded off body.id so
// each part drifts on its own phase, no synchronized "wave" across limbs.
// Coefficient 0.45 yields a visible cycle around 3–5 s.
export function idleAngVelDelta(part, now, amp) {
  const tSec = now / 1000;
  const phase = (part.id || 0) * 1.31;
  return pseudoNoise(tSec * 0.45, phase) * amp;
}

export const IDLE_DRIFT_AMP_ARM  = 0.020;  // rad/s, arms swing the most
export const IDLE_DRIFT_AMP_LIMB = 0.012;  // rad/s, legs/feet, smaller
export const IDLE_DRIFT_AMP_HEAD = 0.010;  // rad/s, head sways gently

const BREATHE_FREQ_HZ = 0.3;   // ≈ 18 breaths/minute, in the human range
const BREATHE_AMP     = 0.018; // ±1.8 % counter-gravity modulation

export function breatheFactor(now) {
  const tSec = now / 1000;
  return 1 + Math.sin(tSec * BREATHE_FREQ_HZ * Math.PI * 2) * BREATHE_AMP;
}

// Convenience: the per-partType idle amplitude used by both rigs.
export function idleAmpFor(partType) {
  if (partType === 'arm')  return IDLE_DRIFT_AMP_ARM;
  if (partType === 'head') return IDLE_DRIFT_AMP_HEAD;
  if (partType === 'leg' || partType === 'foot') return IDLE_DRIFT_AMP_LIMB;
  return 0;  // torso/pelvis are the breathing anchor, no angular drift
}
