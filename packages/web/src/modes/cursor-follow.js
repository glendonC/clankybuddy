// B4 — cursor-follow Mode (the one new substrate this batch names).
//
// docs/abilities-v3.md §4.4: "Mode = follow the cursor" (distinct from the
// generic per-body onTick hook, which follows a BODY). A phase:'frame' Mode
// that, while enabled, nudges a SINGLE module-level latched part toward the
// live cursor each render frame with a BOUNDED kinematic velocity-blend.
//
// Two consumers share this one Mode:
//   - Shepherd's crook: latches while held (kind:'hold'), released by the
//     generic forceMode→teardown seam (input/mouse.js endPress on mouseup/
//     mouseleave + ui/hotbar.js setActiveTool on tool-switch read the row's
//     forceMode tag and setEnabled('cursor.follow', false) → teardown()).
//   - Marionette (a meathook cash-in): latches for a timed window after a
//     spear, released loop-driven by the releaseAt check below (NO setTimeout).
//
// WHY VELOCITY, NOT setPosition: a per-frame Body.setPosition snap fights the
// 0.85-stiffness ragdoll joints — the documented NaN trap. We instead BLEND
// the part's velocity toward a clamped follow-velocity, so the joint solver
// still resolves the other 5 balls each physics frame and nothing can blow up.
// Every guard below is transposed from force-magnet.js's scar list (EPS
// zero-distance, hard speed clamp, finite-check) from the force lane to the
// velocity lane. This Mode does NOT lift the whole body, so it touches NO
// COUNTER_GRAVITY_NEUTRALIZER and NO isStanding gate — it drags one limb under
// normal gravity (the "slack limb on a hook" read).

import Matter from 'matter-js';
import { register, setEnabled } from './bus.js';
import { mouseConstraint } from '../state/world.js';

const { Body } = Matter;

export const CURSOR_FOLLOW_ID = 'cursor.follow';

// --- Tuned constants (the NaN guards live here, not at the call site) ---

// Below this cursor↔part distance the part is effectively AT the cursor: apply
// ZERO nudge. This is the real singularity guard, NOT a `|| 1` divisor (which
// would still normalize a ~0 delta into a near-random direction the speed
// clamp then scales up). Same scar as force-magnet.js's EPS.
const EPS = 1e-3;
// Hard ceiling on the follow speed (px/step). Even at full stretch the nudge
// can never exceed this, so it can't destabilize the joint solver in one step.
// Same order as meathook's yank=16 and the grenade clamp=22 — proven-safe
// additive-velocity magnitudes.
const MAX_FOLLOW_SPEED = 22;
// Distance → target-speed gain. At ~122px of stretch the gain already saturates
// the MAX clamp, so the part chases hard when far and eases as it closes.
const FOLLOW_GAIN = 0.18;
// Soft-latch blend: new velocity = (1-BLEND)*current + BLEND*target. Below 1 so
// we never hard-set the part's velocity to the target — the joint solver keeps
// authority over the other 5 balls. This is the explicit answer to "a hard snap
// fights the joints."
const FOLLOW_BLEND = 0.45;

// Single-latch singleton. A second latchPart() overwrites (last-writer-wins);
// the crook and marionette are mutually exclusive in practice (R2).
let _latch = null;   // { part, epoch, maxReach, releaseAt } | null

/**
 * Latch a part into the cursor-follow Mode and enable the Mode.
 * @param {object} part   a ragdoll part body
 * @param {{ epoch:number, maxReach?:number, releaseAt?:number }} opts
 *        epoch     — the abilityCtx._epoch captured at latch time (char-switch guard)
 *        maxReach  — px; the latch auto-releases past this stretch (the hook slips)
 *        releaseAt — performance.now() ms after which the latch auto-releases
 *                    (marionette's timed window; loop-driven, not a timer)
 */
export function latchPart(part, { epoch, maxReach = 0, releaseAt = 0 } = {}) {
  if (!part) return;
  _latch = { part, epoch, maxReach, releaseAt };
  setEnabled(CURSOR_FOLLOW_ID, true);
}

/** Drop the current latch and disable the Mode. Idempotent. */
export function releaseLatch() {
  _latch = null;
  setEnabled(CURSOR_FOLLOW_ID, false);
}

export function isLatched() { return _latch !== null; }

/** The currently-latched part (or null) — used by the crook cursor to draw the
 *  tether to the actual hooked limb rather than re-guessing the nearest part. */
export function getLatchedPart() { return _latch ? _latch.part : null; }

function tick(ctx) {
  const rec = _latch;
  if (!rec) return;

  // Buddy gone / mid-respawn: drop the latch.
  const ragdoll = ctx?.ragdoll;
  if (!ragdoll || !ragdoll.parts) { releaseLatch(); return; }

  // EPOCH GUARD: a character switch bumps the epoch via spawnRagdoll. Drop the
  // latch so the new buddy is never dragged by a stale part reference. Belt-and
  // -suspenders with the parts.includes check (the old part isn't in the new
  // ragdoll either).
  if (!ctx._epochValid(rec.epoch) || !ragdoll.parts.includes(rec.part)) {
    releaseLatch();
    return;
  }

  // TIMED RELEASE (marionette window) — loop-driven, NO setTimeout.
  if (rec.releaseAt && performance.now() >= rec.releaseAt) { releaseLatch(); return; }

  // Live cursor (Matter updates this on every mouse/touch move). A frame-phase
  // Mode has no event args, so this singleton is the canonical pointer read —
  // identical to force-magnet.js. If it's missing/NaN, keep the latch but skip
  // this frame.
  const cur = mouseConstraint?.mouse?.position;
  if (!cur || !Number.isFinite(cur.x) || !Number.isFinite(cur.y)) return;

  const part = rec.part;
  const dx = cur.x - part.position.x;
  const dy = cur.y - part.position.y;
  const dist = Math.hypot(dx, dy);

  // MAX-REACH auto-release: the limb slipped off the hook.
  if (rec.maxReach && dist > rec.maxReach) { releaseLatch(); return; }
  // At-cursor singularity: ZERO nudge (NaN guard — see EPS note).
  if (dist < EPS) return;

  const speed = Math.min(MAX_FOLLOW_SPEED, dist * FOLLOW_GAIN);
  const nx = dx / dist, ny = dy / dist;
  const vx = part.velocity.x * (1 - FOLLOW_BLEND) + nx * speed * FOLLOW_BLEND;
  const vy = part.velocity.y * (1 - FOLLOW_BLEND) + ny * speed * FOLLOW_BLEND;
  if (!Number.isFinite(vx) || !Number.isFinite(vy)) return;
  Body.setVelocity(part, { x: vx, y: vy });
}

register({
  id: CURSOR_FOLLOW_ID,
  phase: 'frame',
  defaultEnabled: false,
  tick,
  // The generic forceMode seam calls setEnabled(id, false) on mouseup /
  // tool-switch; _applyToggle(false) runs this teardown, which drops the latch.
  teardown() { releaseLatch(); },
});
