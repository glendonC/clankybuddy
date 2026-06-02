// Summons substrate (phase:'physics' force Mode). The shared per-frame driver
// for every autonomous hostile summon (Attack dog first; snake / rat / sentry
// turret / hornet / quadcopter drone / crane claw ride this exact loop later
// with ZERO edits here).
//
// Summons live in ctx.transientBodies (so cleanupTransients' lifeMs removal +
// the spawnRagdoll character-switch wipe + epoch handling all apply for FREE).
// Each summon body carries a `_summonTick(self, ctx, dt)` controller fn pointer;
// this Mode iterates the live transients and dispatches that fn each physics
// step. It contains NO summon-specific logic — all behaviour lives on the body
// + its controller, which is the reusable seam. Phase MUST be 'physics' because
// a summon (the dog's bite) applies IMPULSE to the ragdoll, and force is
// forbidden in the kinematic-only per-body onTick hook (transients/index.js).
//
// STATELESS: the Mode holds no module-level state (unlike force-flood/force-
// strafe, which latch an event and therefore need clearFlood/clearStrafe in
// spawnRagdoll). All summon state lives on the body, which the transient wipe
// removes — so there is NO clearSummons() and no spawnRagdoll hook needed. The
// ability flips the Mode on at spawn; it self-disables when no summons remain
// (the gravity-well "self-disable when empty" pattern).

import { register, setEnabled } from './bus.js';

export const SUMMONS_ID = 'summons';

function tick(ctx, dt) {
  const tb = ctx?.transientBodies;
  if (!tb || !tb.length) { setEnabled(SUMMONS_ID, false); return; }   // nothing live → self-disable
  const ragdoll = ctx?.ragdoll;
  if (!ragdoll || !ragdoll.parts) return;
  // Index loop over the LIVE array (controllers never splice tb; the only tb
  // removals are cleanupTransients + the spawnRagdoll wipe, both OUTSIDE this
  // inner physics loop). A controller marking itself _spent is harmless — the
  // next pass simply skips it.
  let live = 0;
  for (let i = 0; i < tb.length; i++) {
    const b = tb[i];
    if (!b || b._spent || typeof b._summonTick !== 'function') continue;
    // Stale-summon gate (defense in depth — fires only in the one frame before
    // the transient wipe runs on a character switch).
    if (ctx._epochValid && !ctx._epochValid(b._epoch)) continue;
    live++;
    b._summonTick(b, ctx, dt);
  }
  if (live === 0) setEnabled(SUMMONS_ID, false);   // bus QUEUES this mid-tick toggle, applies after the pass
}

register({ id: SUMMONS_ID, phase: 'physics', defaultEnabled: false, tick });
