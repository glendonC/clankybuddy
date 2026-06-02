// Sentry turret — the FIRST static + FIRST ranged summon. A stationary
// auto-turret placed at the cursor: it tracks the buddy (atan2 → nearestPart)
// and fires plain bullets on an interval until it runs dry. Rides the summons
// substrate (modes/summons.js dispatches body._summonTick) with ZERO Mode edits.
//
// THE VERB (distinct from the dog/snake mobile melee seekers): static + ranged.
// The turret applies ZERO force/impulse to the ragdoll — it spawns 'bullet'
// transients and all damage flows through the PROVEN transients/bullet.js
// dryBulletHit. So this is NOT a force-on-ragdoll controller and needs no sim
// (build-green + DAG-green + static verify, like the firearm forks).
//
// BODY: a render-only SENSOR (isStatic + isSensor + mask:0), matching the live
// placed-hazard family (gas_cloud/subwoofer/gravity_well) rather than a solid
// HUD obstacle — it emits no collision pairs, so it can't ground/pin/NaN the
// buddy or be hit by its own bullet; the spec's "HUD category" wording is
// overridden for the sensor path with that justification.

import Matter from 'matter-js';
import * as P from '../../particles.js';
import { getStats } from '../_stats.js';
import { canvas } from '../../state/world.js';
import { FLOOR_INSET } from '../../physics/constants.js';
import { sfx } from '../../audio/sfx.js';
import { startCooldown } from '../../ui/hotbar.js';
import { setEnabled } from '../../modes/bus.js';
import { SUMMONS_ID } from '../../modes/summons.js';
import { nearestPart, dirTo } from '../_shared.js';

const { Body, Bodies, Composite } = Matter;

// --- Module-const firewalls (a stat can never raise these) ---
const MAX_LIVE_TURRETS  = 3;     // cumulative-fire bound (rapid-click guard)
const MUZZLE_OFFSET     = 26;    // > TURRET_H/2 so the bullet clears the barrel tip
const MIN_FIRE_INTERVAL_MS = 400;// floor on fire cadence — no leaf/save-edit can make a bullet hose
const TURRET_W = 30, TURRET_H = 34;

export const defaultStats = {
  damage:         7,      // bullet.bulletDamage — autonomous chip emitter (gun is 10)
  bulletSpeed:    16,     // px/step (gun 22; a turret round, reads as a shot)
  stunMs:         200,    // light (gun 350) — sustained auto-fire shouldn't perma-lock the stand pose
  fireIntervalMs: 800,    // ~1.25 shots/s; floored at MIN_FIRE_INTERVAL_MS at latch
  range:          520,    // only fires when a part is within this; the barrel tracks even out of range
  lifeMs:         14000,  // finite emplacement life; cleanupTransients despawns at bornAt+lifeMs
};

// Per-turret controller, dispatched by modes/summons.js via body._summonTick.
// Reads LATCHED body fields, not getStats (a mid-life purchase can't reshape a
// live turret). The turret writes NO force to any ragdoll part — only spawns a
// bullet. dt unused (interval is wall-clock via performance.now, no setTimeout).
function turretTick(self, ctx) {
  const ragdoll = ctx.ragdoll;
  if (!ragdoll || !ragdoll.parts || !ragdoll.parts.length) return;
  const now = performance.now();

  // AIM — raw atan2 to the nearest part (NOT aimAngle(), which gates tracking
  // behind the player's firearms.aimbot flag; the turret is not a player firearm
  // and always tracks). Store the angle BEFORE the range gate so the barrel
  // visibly tracks even out of range / between shots.
  const nearest = nearestPart(ragdoll, self.position.x, self.position.y);
  if (!nearest) return;
  const { nx, ny, dist } = dirTo(self.position.x, self.position.y, nearest.position.x, nearest.position.y);
  self._aimAngle = Math.atan2(ny, nx);

  if (dist > self._range) return;                          // RANGE GATE (barrel still tracked above)
  if (now - (self._lastShotAt || 0) < self._fireIntervalMs) return;   // interval throttle
  self._lastShotAt = now;

  // Spawn ONE plain bullet at the muzzle, toward the nearest part. NO markPierce
  // (that reads the player's firearms.pierce flag — the turret is not a player gun).
  const mx = self.position.x + nx * MUZZLE_OFFSET;
  const my = self.position.y + ny * MUZZLE_OFFSET;
  const bullet = Bodies.circle(mx, my, 4, {
    frictionAir: 0, friction: 0, density: 0.004, restitution: 0.1,
    label: 'bullet', render: { visible: false },
  });
  bullet.partType    = 'bullet';                           // → transients/bullet.js dryBulletHit (registered handler)
  bullet._verb       = self._verb || 'sentry_turret';
  bullet.bornAt      = now;
  bullet.lifeMs      = 1200;                               // short bullet life (gun.js parity), distinct from the turret's lifeMs
  bullet.bulletDamage = self._damage;
  bullet.bulletStun  = self._stunMs;
  Body.setVelocity(bullet, { x: nx * self._bulletSpeed, y: ny * self._bulletSpeed });
  Composite.add(ctx.world, bullet);                        // append-only (the Mode iterates tb by index; a no-_summonTick bullet is skipped)
  ctx.transientBodies.push(bullet);

  sfx.turretShot?.();
  ctx.screenShake?.(2, 60);
  P.burst(mx, my, 6, { type: 'fire', color: '#ffd266', size: 4, life: 140, speedRange: 0.5 });
}

export default {
  id: 'sentry_turret',
  defaultStats,
  apply(ctx) {
    const s = getStats('sentry_turret');
    const { world, x, transientBodies, ragdoll } = ctx;
    if (!ragdoll || !ragdoll.parts || !ragdoll.parts.length) return;

    const live = transientBodies.filter(b => b && b.partType === 'sentry_turret' && !b._spent).length;
    if (live >= MAX_LIVE_TURRETS) return;                  // field full → no-op click

    const groundY = canvas.height - FLOOR_INSET - TURRET_H / 2 - 2;
    const cx = Math.max(TURRET_W, Math.min(canvas.width - TURRET_W, x));   // clamp on-screen
    const turret = Bodies.rectangle(cx, groundY, TURRET_W, TURRET_H, {
      isStatic: true, isSensor: true, collisionFilter: { mask: 0 },
      label: 'sentry_turret', render: { visible: false },
    });
    turret.partType   = 'sentry_turret';
    turret._summonTick = turretTick;
    turret._verb       = ctx._verb || 'sentry_turret';
    turret.bornAt      = performance.now();
    turret.lifeMs      = s.lifeMs ?? 14000;
    turret._epoch      = ctx._epoch;
    // Latch tuning (controller reads body fields). fireIntervalMs floored so no
    // stat/save-edit can drop it into bullet-hose territory.
    turret._damage = s.damage ?? 7;
    turret._bulletSpeed = s.bulletSpeed ?? 16;
    turret._stunMs = s.stunMs ?? 200;
    turret._fireIntervalMs = Math.max(s.fireIntervalMs ?? 800, MIN_FIRE_INTERVAL_MS);
    turret._range = s.range ?? 520;
    turret._lastShotAt = 0;
    turret._aimAngle = -Math.PI / 2;                       // barrel up until the first tick aims it
    Composite.add(world, turret);
    transientBodies.push(turret);
    setEnabled(SUMMONS_ID, true);
    sfx.turretDeploy?.();
    startCooldown('sentry_turret');
  },
  drawCursor(rctx, { x, y }) {
    // Pedestal + a stubby barrel (place tool, no reticle).
    rctx.save();
    rctx.translate(x, y);
    rctx.fillStyle = '#3a3f47';
    rctx.fillRect(-8, 2, 16, 9);                            // base
    rctx.fillStyle = '#52565e';
    rctx.beginPath(); rctx.arc(0, -1, 6, 0, Math.PI * 2); rctx.fill();   // turret head
    rctx.fillStyle = '#1c1c20';
    rctx.fillRect(2, -3, 12, 4);                            // barrel
    rctx.restore();
  },
};
