// Piercing slug, multi-contact line-drill handler (Phase 4 pierce_bullet
// dispatcher substrate). A sniper / railgun round keeps flying through the
// ragdoll, applying a full bullet hit (dryBulletHit, shared with the plain
// bullet handler) to each part it crosses, until its pierce budget is spent.
//
// DISPATCH CONTRACT (transients/index.js):
//   removeOnContact:false + multiContact:true  → the slug opts OUT of the
//   _spent gate, so it survives every contact and re-fires on later parts. The
//   dispatcher removes it only when onContact returns `true`; we return true on
//   the budget-exhausting hit (and lifeMs is the fallback removal otherwise).
//
//   Because multiContact bypasses the _spent gate, two collision pairs in the
//   SAME physics step both reach onContact. The TOP GUARD below no-ops once the
//   budget is gone so a budget-N slug pierces at most N parts (never N+1 on a
//   simultaneous double-contact). Composite.remove + the splice index guard in
//   the dispatcher are idempotent, so re-signalling removal is safe.
//
// _hitSet dedupes per slug (own-property, GC'd with the body): a part already
// drilled is skipped — no re-hit, no re-bleed, no extra decrement. NEVER sets
// self._spent. All work is per-contact (no onTick).

import { dryBulletHit } from './bullet.js';
import { isBrittle } from '../effects/registry.js';
import { shatter } from '../abilities/_shared.js';

export default {
  partType: 'pierce_bullet',
  removeOnContact: false,
  multiContact:    true,
  onContact(self, target, ctx) {
    // Budget already spent (or slug already removed this step): no-op + force-expire.
    if ((self._pierceLeft ?? 0) <= 0) return true;
    if (!ctx.ragdoll) return false;
    if (!self._hitSet) self._hitSet = new Set();
    // Already drilled this part — skip without spending budget.
    if (self._hitSet.has(target.id)) return false;
    self._hitSet.add(target.id);
    dryBulletHit(self, target, ctx);   // full per-part bullet hit + firearms ammo flags
    // Anti-materiel layer: a frozen part the slug crosses shatters clean off
    // (deterministic, vs dryBulletHit's probabilistic frozen roll). _pierceShatter
    // is set only by the sniper's Anti-materiel upgrade; undefined elsewhere.
    if (self._pierceShatter && isBrittle(ctx.status, target)) shatter(ctx, target);
    self._pierceLeft -= 1;
    return self._pierceLeft <= 0;      // remove on the part that exhausts the budget
  },
};
