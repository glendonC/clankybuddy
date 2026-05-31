// Electrified panel — a placed STATIC sensor plate that zaps anything touching
// it. Modeled on the bear-trap + firepool + caltrops static-sensor lineage and
// the SENSOR-TRAP template in the hazard infra contract.
//
// Behavior: any buddy part in contact gets applyStatus('electrified') on a
// ~400ms per-part throttle (multiContact:true so it isn't burned by _spent
// gating; removeOnContact:false so the plate persists for its lifeMs). Stand
// the buddy on the plate and it re-zaps every throttle window — a slow-grind
// hazard, the electric cousin of caltrops.
//
// FAMILY FLAGS (read live INSIDE onContact via getFamilyStats('hazard'), never
// at module top level; live ES binding picks up purchases):
//   hazard.chain — after this plate zaps, it fires every placed trap within
//     CHAIN_RADIUS via chainDetonate (each neighbor replays its own detonation
//     through the chainTrigger closure it registered). A panel chain re-zaps,
//     a landmine chain explodes, a cryo-mine chain freezes — each kind owns its
//     payload. The shared detonate() here is reused by both onContact and the
//     chainTrigger closure (registered by the spawning ability), so a chained
//     panel zaps the buddy exactly as a stepped-on one does.
//   hazard.rearm — irrelevant to a persistent re-zapping plate (it never
//     single-fires), but honored for symmetry: when OFF the plate still lives
//     for its full lifeMs (it's a lingering field, not a one-shot), so there is
//     no force-expire branch — lifeMs owns removal, matching caltrops/firepool.
//
// INTEGRATOR: this is a NEW transient module and MUST be registered in
// transients/index.js (import + add to the HANDLERS array) or onContact will
// never fire. The plate body is spawned + registerPlacedHazard()'d by the
// placement ability (abilities/punish/electrified-panel.js).

import * as P from '../particles.js';
import { applyStatus } from '../effects/registry.js';
import { getFamilyStats } from '../abilities/_stats.js';
import { chainDetonate } from '../state/hazard-field.js';
import { sfx } from '../audio/sfx.js';

// Per-part throttle: one walk-through across the buddy's 6 parts must not tally
// 6 zaps in a step, and standing on the plate re-zaps at most this often.
const PART_THROTTLE_MS = 400;
const ELECTRIFIED_MS = 600;       // status duration handed to each zap
const CHAIN_RADIUS = 160;         // hazard.chain fan-out reach

// The actual zap payload. Reused by onContact AND by the chainTrigger closure
// the spawning ability registers (chain caller fires detonate(entry.body, ctx)).
// For a chain-fired plate there is no specific contact part, so it zaps every
// ragdoll part currently overlapping the plate's footprint; for a stepped-on
// plate `target` is the contacting part.
function zapPart(self, part, ctx) {
  applyStatus(ctx.status, part, 'electrified', {
    duration: self?._electrifiedMs ?? ELECTRIFIED_MS,
    source: 'electrified_panel',
  });
}

// Live-wire arc burst at the plate, biased up toward the zapped part.
function arcBurst(self, part) {
  const px = part?.position?.x ?? self.position.x;
  const py = part?.position?.y ?? self.position.y;
  P.burst(px, py, 7, {
    type: 'spark', color: '#9be7ff', size: 2.5, life: 220, speedRange: 1.1, gravity: 0,
  });
  P.burst(self.position.x, self.position.y, 4, {
    type: 'spark', color: '#dff6ff', size: 2, life: 160, speedRange: 0.7, gravity: 0,
  });
}

// Detonate path used by the chain caller (no specific contact part): re-zap any
// ragdoll part overlapping the plate's footprint. Mirrors the per-part throttle
// so a chain wave doesn't double-stamp a part the contact path just zapped.
function detonate(self, ctx) {
  const now = performance.now();
  self._lastByPart ??= {};
  const parts = ctx?.ragdoll?.parts ?? [];
  const halfW = (self._width ?? 90) / 2 + 8;
  const halfH = (self._height ?? 12) / 2 + 14;
  let zapped = false;
  for (const part of parts) {
    const dx = Math.abs(part.position.x - self.position.x);
    const dy = Math.abs(part.position.y - self.position.y);
    if (dx > halfW || dy > halfH) continue;          // not over the plate
    if (now - (self._lastByPart[part.id] ?? 0) < PART_THROTTLE_MS) continue;
    self._lastByPart[part.id] = now;
    zapPart(self, part, ctx);
    arcBurst(self, part);
    zapped = true;
  }
  if (zapped) { sfx.zap?.(); ctx.hitStop?.projSmall?.(); }
}

export default {
  partType: 'electrified_panel',
  // Persistent re-zapping plate: survives contact (lifeMs owns removal) and opts
  // out of _spent gating so the per-part throttle controls re-fires.
  removeOnContact: false,
  multiContact:    true,
  onContact(self, target, ctx) {
    const now = performance.now();

    // Per-part throttle: dedupe the 6-part walk-through into one zap per part
    // per window (firepool's per-target _lastIgnite model, made per-part).
    self._lastByPart ??= {};
    if (now - (self._lastByPart[target.id] ?? 0) < PART_THROTTLE_MS) return false;
    self._lastByPart[target.id] = now;

    zapPart(self, target, ctx);
    arcBurst(self, target);
    sfx.zap?.();
    ctx.hitStop?.projSmall?.();

    // CHAIN (flag-gated, read live): a triggered plate fans out to neighbors.
    const fam = getFamilyStats('hazard');
    if (fam.chain) {
      chainDetonate(self.position.x, self.position.y, CHAIN_RADIUS, ctx, { exclude: self });
    }

    // No rearm/force-expire branch: this is a lingering field (caltrops/firepool
    // model), so it never single-fires — lifeMs owns removal.
    return false;
  },
};

// Exported so the placement ability can build its chainTrigger closure off the
// exact same payload (chained plate zaps the buddy identically to a stepped one).
export { detonate };
