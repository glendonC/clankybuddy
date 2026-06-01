// Transient body lifecycle: collision dispatch + lifetime cleanup + fuse beep.
//
// Two collision-handling patterns are supported:
//   1. Ad-hoc `body.onHit` closure (rocket/fireball/anvil), set by the ability
//      that spawned the body. Fires on ANY collision, removes on first hit.
//   2. partType-registered handler, module here owns onContact for its type.
//      Fires only on contact with a ragdoll part. Honors removeOnContact.

import Matter from 'matter-js';
import { sfx } from '../audio/sfx.js';

import treat            from './treat.js';
import gift             from './gift.js';
import bullet           from './bullet.js';
import pierceBullet     from './pierce-bullet.js';
import firepool         from './firepool.js';
import sawblade         from './sawblade.js';
import bearTrap         from './bear-trap.js';
import meathook         from './meathook.js';
import caltrops         from './caltrops.js';
import steamrollerH     from './steamroller.js';
import cityBusH         from './city-bus.js';
import officeChairH     from './office-chair.js';
import acidPool         from './acid-pool.js';
import landmineH        from './landmine.js';
import electrifiedPanel from './electrified-panel.js';
import buzzsawWall      from './buzzsaw-wall.js';
import cryoMine         from './cryo-mine.js';
import gasCloudH        from './gas-cloud.js';
import chainShotH       from './chain-shot.js';
import wreckingBallH    from './wrecking-ball.js';

const { Composite } = Matter;

// NOTE: mode-collapse-zone.js stays on disk as the dormant debounced-pass
// sensor template (reused by the Phase 3 placed-zone tools — tar pit, gas
// cloud, caltrops). It is intentionally NOT registered here: nothing spawns
// it now that the `poison` tool is cut.
const HANDLERS = {};
[treat, gift, bullet, pierceBullet, firepool, sawblade, bearTrap, meathook, caltrops, steamrollerH, cityBusH, officeChairH, acidPool, landmineH, electrifiedPanel, buzzsawWall, cryoMine, gasCloudH, chainShotH, wreckingBallH]
  .forEach(h => { HANDLERS[h.partType] = h; });

export function getTransientHandler(partType) { return HANDLERS[partType] || null; }

// Called from main.js's collisionStart for each ordered (a, b) pair.
export function processCollision(a, b, ctx) {
  const hitCtx = ctxWithVerb(ctx, a._verb);
  const { world, transientBodies, ragdoll } = hitCtx;
  if (!ragdoll) return;
  const pt = a.partType;
  if (!pt) return;

  // Pattern 1: ad-hoc onHit (rocket/fireball/anvil, fires against ragdoll OR walls).
  if (a.onHit && !a._spent) {
    a._spent = true;
    a.onHit(a, world, hitCtx);
    Composite.remove(world, a);
    const i = transientBodies.indexOf(a);
    if (i >= 0) transientBodies.splice(i, 1);
    return;
  }

  // Pattern 2: only fires on ragdoll-part contact.
  if (!ragdoll.parts.includes(b)) return;
  const handler = HANDLERS[pt];
  if (!handler?.onContact) return;
  // Guard against double-fire when one transient contacts two ragdoll parts
  // in the same physics step. Matter emits each pair in one collisionStart
  // event; without _spent the handler runs N times before any cleanup runs.
  // Handlers that explicitly *want* multi-contact (e.g. firepool, mode-
  // collapse-zone) set removeOnContact: false AND opt out of _spent gating
  // by setting `multiContact: true` on their handler module.
  if (a._spent && !handler.multiContact) return;
  // Phase 4: handler may return `true` to force-expire on this contact even
  // if it set removeOnContact:false (a placed multi-pass zone uses this,
  // stays alive across N contacts, then signals expiry on the Nth).
  const handlerSaysRemove = handler.onContact(a, b, hitCtx);
  const remove = handlerSaysRemove === true || handler.removeOnContact !== false;
  if (remove) {
    a._spent = true;
    Composite.remove(world, a);
    const i = transientBodies.indexOf(a);
    if (i >= 0) transientBodies.splice(i, 1);
  } else if (!handler.multiContact) {
    // Non-multi-contact handlers (treat / gift / bullet / sawblade /
    // bear-trap / meathook) burn after first contact even if they opted
    // out of removal via handlerSaysRemove. Without this they'd refire on
    // every subsequent pair this frame.
    a._spent = true;
  }
}

// Lifetime + fuse-beep tick. makeCtx is the abilityCtx() factory so each
// onExpire callback gets a fresh ctx snapshot (same epoch-capture behavior
// as the original main.js loop).
export function cleanupTransients(world, transientBodies, makeCtx) {
  const now = performance.now();
  for (let i = transientBodies.length - 1; i >= 0; i--) {
    const b = transientBodies[i];

    // Grenade fuse: accelerating beep, then explosion when fuseAt elapses.
    if (b.partType === 'grenade' && b.fuseAt) {
      const remaining = b.fuseAt - now;
      if (remaining > 0) {
        const interval = remaining < 400 ? 70 : remaining < 1000 ? 200 : 380;
        if (!b._lastFuseBeep || now - b._lastFuseBeep > interval) {
          b._lastFuseBeep = now;
          sfx.grenadeFuse();
        }
      } else if (!b._spent) {
        b._spent = true;
        if (b.onExpire) b.onExpire(b, ctxForTransient(makeCtx, b));
        Composite.remove(world, b);
        transientBodies.splice(i, 1);
        continue;
      }
    }

    // Generic per-body onTick hook (render-frame, once per body per frame).
    //
    // KINEMATIC-ONLY CONTRACT: onTick runs in the render frame (cleanupTransients
    // is called once per frame from main.js), NOT per physics sub-step. It may
    // only do kinematic work — Body.setVelocity / Body.setPosition, off-screen /
    // position checks, and self-removal. It MUST NOT apply force or call
    // sweepImpact: those integrate per sub-step and belong in onContact (per
    // collision) or a phase:'physics' Mode. Maintained x-velocity rollers
    // (steamroller / city bus) re-stamp velocity here; per-frame is exactly the
    // anvil "maintained velocity" trick the design calls for.
    //
    // EPOCH-GATED: the body stores self._epoch at spawn. We build a per-body ctx
    // (same fresh-snapshot + verb wrapping every onExpire gets) and only invoke
    // onTick when !b._spent AND ctx._epochValid(b._epoch). After a character
    // switch the epoch no longer matches and onTick goes silent, matching the
    // setTimeout discipline in CLAUDE.md.
    //
    // SELF-REMOVAL: a self-removing onTick (e.g. a vehicle that has driven fully
    // off-screen) sets b._spent = true and splices itself out exactly once. The
    // age check below then sees _spent and skips re-removal, and the !b._spent
    // guard here prevents a double onTick in the same pass.
    if (b.onTick && !b._spent) {
      const tickCtx = ctxForTransient(makeCtx, b);
      if (tickCtx._epochValid(b._epoch)) {
        b.onTick(b, tickCtx);
        // onTick may have self-removed (set _spent + spliced). If so, skip the
        // rest of this body's processing this frame.
        if (b._spent && transientBodies[i] !== b) continue;
      }
    }

    const age = now - (b.bornAt ?? now);
    const life = b.lifeMs ?? 6000;
    if (age > life) {
      if (b.onExpire && !b._spent) {
        b._spent = true;
        b.onExpire(b, ctxForTransient(makeCtx, b));
      }
      Composite.remove(world, b);
      transientBodies.splice(i, 1);
    }
  }
}

function ctxForTransient(makeCtx, body) {
  const ctx = makeCtx();
  return ctxWithVerb(ctx, body._verb);
}

function ctxWithVerb(ctx, verb) {
  if (!verb) return ctx;
  return {
    ...ctx,
    _verb: verb,
    recordHit: (hit) => ctx.recordHit?.({ ...hit, verb: hit?.verb || verb }),
  };
}
