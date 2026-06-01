// @ts-check
// Gas cloud — placed drifting sensor zone that stamps CHOKING on every part that
// dwells in it. Reuses the placed-sensor + per-part-throttle lineage
// (electrified-panel / cryo-mine): multiContact:true so the 6-part walk-through
// isn't burned by _spent gating, removeOnContact:false so the cloud persists for
// its lifeMs, and a PER-PART ~450ms throttle so each limb chokes at most once per
// window (we WANT every limb choking, unlike mode-collapse-zone's zone-wide
// debounce). The visible cloud drifts in RENDER only — the sensor stays put so a
// dwell-trap punishes dwelling where you placed it (render/transients.js).
//
// Four variant payloads, branched on self._variant:
//   base     — plain choking (mood DoT + flail + stun-recovery debuff).
//   tear     — choking with data.panic → choking.onTick swaps the stun debuff
//              for a blind panic-run.
//   chlorine — choking whose intensity STACKS (capped) on each pass.
//   cryo     — choking + after a per-part dwell counter reaches dwellPasses, also
//              stamp the existing `frozen` status (reuse — sets up the shatter).
//
// FAMILY FLAG (read live via getFamilyStats('hazard').chain): a chained cloud
// re-stamps choking on overlapping parts through the shared detonate() the
// placement ability registers — identical to electrified-panel / cryo-mine.
//
// INTEGRATOR: NEW module — MUST be registered in transients/index.js (import +
// HANDLERS array) or onContact never fires.

import { applyStatus, getStatus } from '../effects/registry.js';
import { getFamilyStats } from '../abilities/_stats.js';
import { chainDetonate } from '../state/hazard-field.js';

const PART_THROTTLE_MS = 450;   // per-part choke re-stamp window
const CHAIN_RADIUS     = 150;   // hazard.chain fan-out reach
const CHLORINE_MAX     = 4;     // intensity cap for the stacking variant
const DWELL_RESET_MS   = 1200;  // cryo dwell counter decays after a gap off the cloud

// Apply the variant's choke payload to one part. Reused by onContact AND the
// chainTrigger detonate() path.
function chokePart(self, part, ctx) {
  const variant = self._variant || 'base';
  const rgb = self._rgb || '155,206,106';
  const dur = self._chokeMs;

  if (variant === 'chlorine') {
    const cur = getStatus(ctx.status, part, 'choking');
    const intensity = Math.min(CHLORINE_MAX, (cur?.intensity || 0) + 1);
    applyStatus(ctx.status, part, 'choking', { duration: dur, intensity, source: 'gas_cloud', data: { rgb } });
    return;
  }

  if (variant === 'cryo') {
    // Dwell counter on the body (wiped with transientBodies on respawn). Decays
    // after a gap so leaving + re-entering doesn't insta-freeze on a stale count.
    const now = performance.now();
    self._dwellByPart ??= {};
    self._dwellSeenAt ??= {};
    const last = self._dwellSeenAt[part.id] || 0;
    const count = (now - last > DWELL_RESET_MS) ? 1 : (self._dwellByPart[part.id] || 0) + 1;
    self._dwellByPart[part.id] = count;
    self._dwellSeenAt[part.id] = now;
    applyStatus(ctx.status, part, 'choking', { duration: dur, intensity: self._chokeIntensity, source: 'gas_cloud', data: { rgb } });
    if (count >= (self._dwellPasses || 2)) {
      applyStatus(ctx.status, part, 'frozen', { source: 'gas_cloud' });
    }
    return;
  }

  // base + tear (tear adds data.panic so choking.onTick runs panic-run not stun).
  const data = variant === 'tear' ? { rgb, panic: true } : { rgb };
  applyStatus(ctx.status, part, 'choking', { duration: dur, intensity: self._chokeIntensity, source: 'gas_cloud', data });
}

// Chain/detonate path (no specific contact part): re-stamp the choke on any
// ragdoll part inside the cloud footprint, same per-part throttle as onContact
// so a chain wave doesn't double-stamp a part the contact path just choked.
export function detonate(self, ctx) {
  if (!self || !ctx?.ragdoll) return;
  const now = performance.now();
  self._lastByPart ??= {};
  const r2 = (self._radius || 70) ** 2;
  for (const part of ctx.ragdoll.parts) {
    const dx = part.position.x - self.position.x;
    const dy = part.position.y - self.position.y;
    if (dx * dx + dy * dy > r2) continue;
    if (now - (self._lastByPart[part.id] ?? 0) < PART_THROTTLE_MS) continue;
    self._lastByPart[part.id] = now;
    chokePart(self, part, ctx);
  }
}

/** @type {import('../types.js').TransientHandler} */
export default {
  partType: 'gas_cloud',
  // Lingering field: survives contact (lifeMs owns removal) + opts out of _spent
  // gating so the per-part throttle controls re-stamps (electrified-panel model).
  removeOnContact: false,
  multiContact:    true,
  onContact(self, target, ctx) {
    const now = performance.now();
    self._lastByPart ??= {};
    if (now - (self._lastByPart[target.id] ?? 0) < PART_THROTTLE_MS) return false;
    self._lastByPart[target.id] = now;

    chokePart(self, target, ctx);

    // CHAIN (flag-gated, read live): a triggered cloud fans out to neighbor traps.
    const fam = getFamilyStats('hazard');
    if (fam.chain) {
      chainDetonate(self.position.x, self.position.y, CHAIN_RADIUS, ctx, { exclude: self });
    }
    return false;   // lingering field — never force-expire (lifeMs owns removal)
  },
};
