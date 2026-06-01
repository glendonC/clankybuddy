// CHOKING status — applied by a gas-cloud dwell. Three behaviors, ALL inside
// onTick (which tickStatuses runs INSIDE the fixed-step physics loop, so it may
// apply force/stun — same lane as effects/in-blackhole.js):
//   1. MOOD DoT  — a light, sustained mood bleed (lighter per-part than fire).
//   2. MICRO-FLAIL — throttled arm jitter / torso wobble (reuses _locomotion).
//   3. REDUCED STAND RECOVERY — intermittent bounded stun() PULSES. This is the
//      ONLY mechanism that defeats stand.js's DOMINANT per-part angular-righting
//      blend: applyStandPose early-returns while now<stunUntil (stand.js), so a
//      brief stun drops BOTH the counter-gravity lift AND the righting torque —
//      the buddy keeps slumping. The pulse is throttled GLOBALLY on the ragdoll
//      (ragdoll._chokeStumbleAt), NOT per status record, so N choking parts
//      collectively trigger at most one ~175ms stun every ~450ms instead of
//      stacking (stun() is monotonic-max) into a permanent lock.
//
// TEAR-GAS variant: stamped with rec.data.panic. The panic branch SWAPS the
// stun-recovery debuff for a blind panic-run (panicRunLeg bails while stunned,
// _locomotion.js, so the two verbs can never co-fire). base/Chlorine/Cryo use
// the stun debuff; Tear gas runs.
//
// FINITE duration (NOT persistent): choking has no opposing input to clear it
// (unlike fire↔freeze), so a persistent choke would strand the buddy stumbling
// forever once the cloud is gone. The cloud re-stamps on every debounced dwell
// pass to keep it topped up while inside; it lapses ~2.2s after the buddy leaves.
//
// NOTE: the DoT rate / stun cadence are FEEL-TUNES (no in-browser verification
// possible here); the GLOBAL stun throttle is the load-bearing CORRECTNESS knob.

import * as P from '../particles.js';
import { applyMoodDelta } from '../mood.js';
import { stun } from '../physics/stand.js';
import { microFlail, stagger, panicRunLeg } from './_locomotion.js';
import { react } from '../reactions/index.js';
import { partRadius } from '../abilities/_shared.js';

const MOOD_DOT      = -0.004;  // mood per ms·intensity (lighter than fire's -0.008)
const FLAIL_CHANCE  = 0.2;     // per-tick jitter probability
const STUMBLE_EVERY = 450;     // ms — GLOBAL ragdoll stun-pulse throttle
const STUMBLE_MS    = 175;     // ms — each bounded stun pulse (stumble-then-right)
const DEFAULT_RGB   = '155,206,106';

export default {
  id: 'choking',
  defaultDuration: 2200,
  layer: 'over',

  onTick(part, rec, ctx, dtMs, now) {
    const ragdoll = ctx.ragdoll;
    if (!ragdoll) return;
    const rgb = rec.data?.rgb || DEFAULT_RGB;

    // 1. Mood DoT (per-part, like fire; multiple choking parts compound).
    applyMoodDelta(ctx.mood, MOOD_DOT * dtMs * (rec.intensity || 1));

    // 2. Micro-flail. Each helper self-gates on partType (arm→microFlail,
    //    torso/head→stagger); legs no-op here — they belong to the panic branch.
    if (Math.random() < FLAIL_CHANCE) { microFlail(part); stagger(part); }

    if (rec.data?.panic) {
      // 3a. TEAR GAS — blind panic-run instead of the stun debuff. Drive BOTH leg
      //     parts ONCE per tick via a GLOBAL latch on the shared `now` (mirroring
      //     the stun gate below) so the panic force can't scale with the number
      //     of choking parts. tickStatuses passes the same `now` to every part in
      //     a pass, so the first choking part claims the tick and the rest skip.
      //     panicRunLeg needs partType==='leg' + bails while stunned; never pass
      //     the dwelling `part`.
      if (ragdoll._chokePanicAt !== now) {
        ragdoll._chokePanicAt = now;
        const bm = ragdoll.bodyMap;
        if (bm?.legL) panicRunLeg(ragdoll, bm.legL);
        if (bm?.legR) panicRunLeg(ragdoll, bm.legR);
      }
    } else if (now - (ragdoll._chokeStumbleAt || 0) > STUMBLE_EVERY) {
      // 3b. REDUCED STAND RECOVERY — one bounded stun pulse, GLOBALLY throttled
      //     so 6 choking parts can't stack into a permanent lock.
      ragdoll._chokeStumbleAt = now;
      stun(ragdoll, STUMBLE_MS);
    }

    if (!rec._spoken) {
      rec._spoken = true;
      // minIntervalMs so 6 simultaneous choking recs — and chlorine's re-stamps,
      // which reset _spoken — don't spam a bubble every pass.
      react({ event: 'choking', mood: ctx.mood, part: ragdoll.head, minIntervalMs: 1200 });
    }

    // Wispy gas rising off the part.
    if (Math.random() < 0.25) {
      P.spawn({
        x: part.position.x + (Math.random() - 0.5) * 16,
        y: part.position.y - 4 + (Math.random() - 0.5) * 16,
        vx: (Math.random() - 0.5) * 0.08, vy: -0.12 - Math.random() * 0.1,
        type: 'smoke', color: `rgb(${rgb})`,
        size: 6 + Math.random() * 4, life: 600 + Math.random() * 300,
        gravity: -0.0003, drag: 0.99,
      });
    }
  },

  render(rctx, ragdoll, records, now) {
    rctx.save();
    for (const { part, rec } of records) {
      const r = partRadius(part) * 1.7;
      const rgb = rec.data?.rgb || DEFAULT_RGB;
      const breathe = 0.6 + Math.sin(now * 0.004 + part.id * 0.7) * 0.25;
      const g = rctx.createRadialGradient(
        part.position.x, part.position.y, 1,
        part.position.x, part.position.y, r,
      );
      g.addColorStop(0,   `rgba(${rgb}, 0)`);
      g.addColorStop(0.5, `rgba(${rgb}, ${0.22 * breathe})`);
      g.addColorStop(1,   `rgba(${rgb}, 0)`);
      rctx.fillStyle = g;
      rctx.beginPath(); rctx.arc(part.position.x, part.position.y, r, 0, Math.PI * 2); rctx.fill();
    }
    rctx.restore();
  },
};
