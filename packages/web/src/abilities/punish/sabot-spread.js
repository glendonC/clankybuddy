import Matter from 'matter-js';
import * as P from '../../particles.js';
import { sfx } from '../../audio/sfx.js';
import { drawAimLine, drawCrosshair } from '../../render/shared-cursor.js';
import { getStats } from '../_stats.js';
import { aimAngle } from '../_shared.js';

const { Body, Bodies, Composite } = Matter;

// Sabot spread — a discarding-sabot load for the railgun (a verb fork off it).
// Fires a CONE of K independent piercing darts instead of one deep slug. Fills
// the one empty cell of the ranged verb matrix (spread × single-line) ×
// (penetrates × stops): grapeshot is SPREAD-but-stops (its damage is a
// synchronous cone-shove pass, pellets die on first contact); railgun/sniper/
// charge_shot are SINGLE-LINE-but-penetrate. Sabot spread is the only tool that
// fires a fan of TRAVELLING penetrators — each a pierce_bullet with its OWN
// _hitSet — so multiple overlapping short drill-lines carve a bunched cluster
// from one pull. Coverage AND drill, which neither neighbor can produce.
//
// TWO LOAD-BEARING INVARIANTS (do not violate or it collapses into grapeshot):
//   1. per-sabot pierce >= 2 — at 1, each dart dies on its first limb like a
//      grapeshot pellet and the verb is gone.
//   2. NO synchronous cone-knockback/mood/stun pass here. The travelling sabots
//      ARE the entire damage model; all mood/knockback/ammo-flags arrive
//      per-drilled-part via dryBulletHit when each sabot's onContact fires
//      (railgun.js calls no reactTo in apply() for exactly this reason — a flat
//      reactTo here would double-count). That is why there is no s.force/
//      s.range/s.mood key: their absence is what keeps this a penetrator, not a
//      shotgun. Per-dart damage/pierce stay STRICTLY below railgun's single
//      slug at every tree state, so the fork is a sidegrade, never an upgrade.
export const defaultStats = {
  damage:  16,    // per-dart, below railgun's 40 (a light dart, not a tungsten slug). READ → bulletDamage.
  sabots:  5,     // odd count: center dart on the aim ray, two pairs fan out. READ → for-loop bound.
  coneRad: 0.42,  // total scatter (radians), tighter than grapeshot's 0.5. READ → fan half-width.
  pierce:  2,     // per-dart drill budget — THE VERB. >= 2 mandatory, below railgun's 4. READ → _pierceLeft.
  speed:   44,    // just below railgun's 48; still a real travelling body. READ → muzzle velocity.
  stunMs:  0,     // sabots are NOT a CC verb (that's grapeshot/sonic). 0 → dryBulletHit skips stun().
  lifeMs:  900,   // fallback removal when a dart's budget goes unspent.
  shake:   9,     // a volley of light darts, below railgun's 14.
};

export default {
  id: 'sabot_spread',
  defaultStats,
  apply(ctx) {
    const s = getStats('sabot_spread');
    const { ragdoll, world, x, y, screenShake } = ctx;
    const { angle: ang0, ok } = aimAngle(ragdoll, x, y);   // 3-arg; family defaults 'firearms'
    if (!ok) return;
    const muzzleX = x + Math.cos(ang0) * 28;
    const muzzleY = y + Math.sin(ang0) * 28;

    for (let i = 0; i < s.sabots; i++) {
      const a = ang0 + (Math.random() - 0.5) * s.coneRad;   // grapeshot cone-fan idiom
      const vx = Math.cos(a) * s.speed, vy = Math.sin(a) * s.speed;
      const sabot = Bodies.circle(muzzleX, muzzleY, 3, {
        frictionAir: 0, friction: 0, density: 0.008, restitution: 0.02,
        label: 'pierce_bullet', render: { visible: false },
      });
      sabot.partType    = 'pierce_bullet';                  // raw → renders cyan penetrator, NO _apConverted/markPierce
      sabot._verb       = ctx._verb || 'sabot_spread';
      sabot.bornAt      = performance.now();
      sabot.lifeMs      = s.lifeMs;
      sabot.bulletDamage = s.damage;
      sabot.bulletStun  = s.stunMs;                         // 0 → truthy-gated stun skipped in dryBulletHit
      sabot._pierceLeft = s.pierce;                         // each dart drills its OWN line
      sabot._hitSet     = new Set();                        // own-property dedupe → darts independent
      Body.setVelocity(sabot, { x: vx, y: vy });            // before push so dryBulletHit reads hit direction
      Composite.add(world, sabot);
      ctx.transientBodies.push(sabot);
    }
    // NO synchronous cone-knockback/mood/stun pass (invariant 2) — pure penetrators.

    sfx.railgun();
    screenShake(s.shake, 200);
    P.burst(muzzleX, muzzleY, 14, { type: 'spark', color: '#9be7ff', size: 4, life: 220, speedRange: 1.6 });
    P.burst(muzzleX, muzzleY, 5,  { type: 'spark', color: '#fff',    size: 2, life: 160, speedRange: 1.8 });
  },
  drawCursor(ctx, { x, y, target, angle }) {
    if (target) drawAimLine(ctx, x, y, target); else drawCrosshair(ctx, x, y);
    // Emitter housing + dual rails (railgun-family silhouette).
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle);
    ctx.fillStyle = '#23232a'; ctx.fillRect(-6, -5, 12, 16);   // taller multi-rail housing
    ctx.fillStyle = '#3a3a44'; ctx.fillRect(2, -6, 26, 3);     // upper rail
    ctx.fillStyle = '#3a3a44'; ctx.fillRect(2,  3, 26, 3);     // lower rail
    ctx.restore();
    // Three-dart cyan fan at the muzzle — telegraphs the SPREAD, the at-a-glance
    // tell that separates it from railgun's single charged-slot rail-line.
    ctx.save();
    ctx.translate(x + Math.cos(angle) * 26, y + Math.sin(angle) * 26);
    ctx.strokeStyle = '#9be7ff'; ctx.lineWidth = 2;
    for (const da of [-0.21, 0, 0.21]) {
      ctx.save(); ctx.rotate(angle + da);
      ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(14, 0); ctx.stroke();
      ctx.restore();
    }
    ctx.restore();
  },
};
