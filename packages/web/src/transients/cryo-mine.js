// @ts-check
// Cryo mine — buried static sensor trap (sensor-trap template: bear-trap +
// firepool + mode-collapse debounce model). Reads like a landmine but the
// payload is an AOE FREEZE BURST, not an explosion: on contact it applies
// `frozen` to every buddy part inside FREEZE_RADIUS (manipulation-style
// control, not damage). The chill that locks the buddy down sets up the
// shatter follow-up the same way the freeze tool does.
//
// Spawn lives in the ability's applyRelease() (abilities/cursor/cryo-mine.js):
//   Bodies.circle(x, y, R, { isStatic:true, isSensor:true, label:'cryo_mine',
//     render:{visible:false} }); body.partType='cryo_mine'; body.bornAt=now;
//   body.lifeMs=<ms>; Composite.add(world, body); transientBodies.push(body);
//   registerPlacedHazard(body, { kind:'cryo_mine',
//     chainTrigger: (entry, ctx2) => detonate(entry.body, ctx2) });
//
// Two cross-tool behaviors hang off getFamilyStats('hazard') BEHAVIOR FLAGS
// (never scalars): hazard.chain fans the freeze out to neighbor traps in
// range; hazard.rearm keeps the mine alive + re-arming instead of single-use.

import Matter from 'matter-js';
import * as P from '../particles.js';
import { applyStatus } from '../effects/registry.js';
import { stun } from '../physics/stand.js';
import { getFamilyStats } from '../abilities/_stats.js';
import { sfx } from '../audio/sfx.js';
import { chainDetonate, unregisterPlacedHazard } from '../state/hazard-field.js';

const { Body } = Matter;

const REARM_MS        = 2600;   // re-arm delay once a mine has fired (rearm flag on)
const PART_THROTTLE_MS = 600;   // per-part debounce: one walk-through != 6 triggers
const CHAIN_RADIUS    = 170;    // neighbor-trap reach for hazard.chain
const FREEZE_RADIUS   = 150;    // AOE freeze burst radius
const FREEZE_STUN_MS  = 1800;   // lockout window (frozen itself is persistent)

// The actual trap payload — an AOE freeze burst centered on the mine. Reused by
// onContact AND by the chainTrigger closure (so a chained mine freezes exactly
// like one stepped on directly). Pure status/control: NO mood damage and NO
// impulse, the manipulation identity is "lock the buddy, let the follow-up hit."
export function detonate(self, ctx) {
  if (!self || !ctx?.ragdoll) return;
  const { ragdoll, status } = ctx;
  const cx = self.position.x, cy = self.position.y;
  const r2 = FREEZE_RADIUS * FREEZE_RADIUS;
  let froze = false;
  for (const p of ragdoll.parts) {
    const dx = p.position.x - cx, dy = p.position.y - cy;
    if (dx * dx + dy * dy > r2) continue;
    // Bleed off velocity so the freeze reads as an instant lock, mirrors the
    // freeze tool's per-part damp. No applyForce — frozen is control, not a hit.
    Body.setVelocity(p, { x: p.velocity.x * 0.1, y: p.velocity.y * 0.1 });
    Body.setAngularVelocity(p, 0);
    applyStatus(status, p, 'frozen', { source: 'cryo_mine' });
    froze = true;
  }
  if (froze) stun(ragdoll, FREEZE_STUN_MS);

  // Pressurized hiss + ice-crackle burst at the mine.
  sfx.cryoMine?.();
  P.burst(cx, cy, 26, { type: 'ice',   color: '#9be7ff', size: 5, life: 1200, speedRange: 1.2, gravity: -0.0002 });
  P.burst(cx, cy, 14, { type: 'smoke', color: '#cdeef7', size: 6, life: 900,  speedRange: 0.5, gravity: -0.0004 });
  P.burst(cx, cy,  8, { type: 'spark', color: '#e8fbff', size: 3, life: 360,  speedRange: 1.0 });
  ctx.screenShake?.(7, 200);
}

export default {
  partType: 'cryo_mine',
  // rearm needs the body to survive contact + opt out of _spent gating. When
  // hazard.rearm is OFF we still force-expire by returning true below.
  removeOnContact: false,
  multiContact:    true,
  onContact(self, target, ctx) {
    const now = performance.now();
    const fam = getFamilyStats('hazard');

    // Re-arm window (only relevant once a mine has fired with hazard.rearm on).
    if (self._armed === false) {
      if (fam.rearm && now >= (self._rearmAt ?? 0)) self._armed = true;
      else return false;                 // disarmed: no-op (renders dim)
    }

    // Per-part throttle: dedupe the 6-part walk-through into one trigger.
    self._lastByPart ??= {};
    if (now - (self._lastByPart[target.id] ?? 0) < PART_THROTTLE_MS) return false;
    self._lastByPart[target.id] = now;

    detonate(self, ctx);

    // CHAIN: a triggered mine arms neighbor traps in range (flag-gated). Each
    // neighbor replays its own detonation via the closure it registered, so a
    // cryo-mine chain freezes outward, a landmine chain explodes, etc.
    if (fam.chain) chainDetonate(self.position.x, self.position.y, CHAIN_RADIUS, ctx, { exclude: self });

    // REARM vs single-use (flag-gated).
    if (fam.rearm) {
      self._armed   = false;
      self._rearmAt = now + REARM_MS;
      return false;                      // stay alive, re-arm later
    }
    unregisterPlacedHazard(self);        // drop registry ref so a chain can't refire a corpse
    return true;                         // force-expire this contact (handlerSaysRemove path)
  },
};
