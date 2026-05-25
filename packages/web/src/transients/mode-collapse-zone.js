// @ts-check
// Mode-collapse zone, invisible 80px sensor dropped by the
// `mode-collapse` ability. Counts buddy passes via _contacts (debounced
// 500ms so a single pass through doesn't tally per-part). On the third
// distinct pass, applies `mode_collapse` to all six parts and signals
// expiry via the new return-`true` semantic in transients/index.js.
// Phase 4 of the 2026-05-02 ability redesign, see docs/abilities.md.

import Matter from 'matter-js';
import { applyStatus, getStatus } from '../effects/registry.js';
import { showCombo } from '../ui/overlays.js';
import { sfx } from '../audio/sfx.js';

const { Bodies, Composite } = Matter;

const DEFAULT_PASSES_REQUIRED = 3;
const CONTACT_DEBOUNCE_MS = 500;

// `config` (added 2026-05-24 for the 2-branch tree):
//   passesRequired, Adversarial-Examples drops this from 3 → 1
//   stacking      , Synthetic-Loop: on apply, if an existing status is
//                    present, increment its intensity instead of refreshing
export function spawnModeCollapseZone(world, transientBodies, x, y, config = {}) {
  const zone = Bodies.circle(x, y, 40, {
    isStatic: true, isSensor: true,
    label: 'mode_collapse_zone', render: { visible: false },
  });
  zone.partType = 'mode_collapse_zone';
  zone.bornAt = performance.now();
  zone.lifeMs = 30000;            // long fuse, patient zone trap
  zone._passes = 0;
  zone._lastContactAt = 0;
  zone._passesRequired = Math.max(1, config.passesRequired ?? DEFAULT_PASSES_REQUIRED);
  zone._stacking = !!config.stacking;
  Composite.add(world, zone);
  transientBodies.push(zone);
  return zone;
}

/** @type {import('../types.js').TransientHandler} */
export default {
  partType: 'mode_collapse_zone',
  removeOnContact: false,         // stays alive across multiple passes
  multiContact:    true,          // opt out of _spent, debounce handles per-pass coalescing
  onContact(self, target, ctx) {
    const now = performance.now();
    // Debounce, a single pass through fires up to 6 part contacts. Treat
    // any contact within 500ms of the last as the same pass.
    if (now - self._lastContactAt < CONTACT_DEBOUNCE_MS) {
      self._lastContactAt = now;
      return false;
    }
    self._lastContactAt = now;
    self._passes += 1;

    if (self._passes < self._passesRequired) {
      // Visual ping so the player knows the trap counted a pass.
      sfx.beep?.();
      return false;
    }

    // Trigger pass, apply MODE_COLLAPSE to head (buddy-wide; damageMul.buddyHas).
    // Synthetic-Loop stacking: if the buddy already has the status, increment
    // intensity instead of refreshing. Cap at 3 so the downstream Total-Collapse
    // consumer has a well-defined "max stacks" trigger.
    const ragdoll = ctx.ragdoll;
    if (ragdoll) {
      const existing = self._stacking ? getStatus(ctx.status, ragdoll.head, 'mode_collapse') : null;
      const intensity = existing ? Math.min((existing.intensity ?? 1) + 1, 3) : 1;
      applyStatus(ctx.status, ragdoll.head, 'mode_collapse', { source: 'mode_collapse', intensity });
      ctx.popBubble?.(ragdoll.head, '…the loop is the loop is the loop…');
    }
    showCombo?.('MODE COLLAPSE', '#a78bfa');
    sfx.zap?.();
    return true;                  // signal expiry, see transients/index.js
  },
};
