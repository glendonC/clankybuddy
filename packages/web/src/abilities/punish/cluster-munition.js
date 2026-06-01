// Cluster munition (ordnance). A drag-lob canister (frag-grenade template) that
// airbursts at its 2s fuse into a CAPPED down-cone fan of bomblets; each bomblet
// is an ad-hoc Pattern-1 onHit that detonates a SMALL blast on contact with the
// buddy or the ground. The canister itself does no damage — it's a dispenser.
//
// HIT-STOP: each bomblet calls hitStop.projSmall() (never explosion-tier) — the
// meteor-shower precedent. A capped fan of ~9-12 small blasts must not lock the
// sim. BOMBLET_CAP hard-bounds the fan so no future stat can flood the transient
// pool / collision handler.
//
// BOMBLET SELF-COLLISION (a blocker the red-team missed): the fan spawns 9-12
// bomblets densely overlapping on a small ring in ONE onExpire. As Pattern-1
// onHit bodies, bomblet-vs-bomblet contact would fire onHit on frame 1 and chain
// -detonate the whole fan at the apex, defeating the rain-down mechanic. Fix:
// bomblets share a single Body.nextGroup(true) NON-COLLIDING group so they pass
// THROUGH each other (Matter: same negative group never collides) while still
// hitting the ragdoll + walls (different group → falls back to mask/category).
// Same idiom the ragdoll itself uses (physics/ragdoll.js:24).

import Matter from 'matter-js';
import { explode } from '../_shared.js';
import { getStats } from '../_stats.js';
import { sfx } from '../../audio/sfx.js';

const { Body, Bodies, Composite } = Matter;

// Hard cap on the fan (collision-handler + pool safety valve).
const BOMBLET_CAP = 12;
const BOMBLET_LIFE_MS = 1800;
// One shared non-colliding group for ALL bomblets, generated once at module load
// (unique + negative; never equals a ragdoll spawn group since the counter only
// advances). Keeps the dense apex fan from chain-detonating against itself.
const BOMBLET_GROUP = Body.nextGroup(true);

export const defaultStats = {
  bomblets:      9,
  fanSpread:     Math.PI * 0.7,   // total down-cone width
  spreadVel:     7,               // outward launch speed of each bomblet
  subRadius:     90,
  subBaseVel:    10,
  subMood:       12,
  igniteBomblets: false,          // Thermite: each bomblet leaves a fire pool
  fireDuration:  1600,
};

export default {
  id: 'cluster_munition',
  defaultStats,
  applyRelease(ctx) {
    const { world, x, y, popBubble, ragdoll, dragVec = { x: 0, y: 0 } } = ctx;
    const dragMag = Math.hypot(dragVec.x, dragVec.y);
    if (dragMag < 24) {
      popBubble(ragdoll.head, 'pull harder!');
      return;
    }
    // Lob kinematics copied VERBATIM from frag-grenade.
    const k = 0.04;
    const vx = Math.max(-15, Math.min(15, dragVec.x * k));
    const vy = Math.max(-18, Math.min(15, dragVec.y * k - 4));

    const canister = Bodies.circle(x, y, 8, {
      frictionAir: 0.01, friction: 0.5, density: 0.0025, restitution: 0.4,
      label: 'grenade', render: { visible: false },
    });
    canister.partType = 'grenade';          // reuse the grenade fuse + render branch
    canister._verb = ctx._verb || 'cluster_munition';
    canister.bornAt = performance.now();
    canister.fuseAt = canister.bornAt + 2000;
    canister.lifeMs = 2100;
    Body.setVelocity(canister, { x: vx, y: vy });
    Body.setAngularVelocity(canister, (Math.random() - 0.5) * 0.2);
    canister.onExpire = (b, ctx2) => {
      const s = getStats('cluster_munition');
      const bx = b.position.x, by = b.position.y;
      const count = Math.min(s.bomblets, BOMBLET_CAP);
      for (let i = 0; i < count; i++) {
        // Even spread across the down-cone; single-bomblet edge case → straight down.
        const frac = count > 1 ? (i / (count - 1)) - 0.5 : 0;
        const ang = Math.PI * 0.5 + frac * s.fanSpread;   // canvas y-down → PI/2 = down
        const ca = Math.cos(ang), sa = Math.sin(ang);
        const bomblet = Bodies.circle(bx + ca * 8, by + sa * 8, 4, {
          frictionAir: 0.005, density: 0.0025, restitution: 0.2,
          collisionFilter: { group: BOMBLET_GROUP },   // pass through each other
          render: { visible: false },
        });
        bomblet.partType = 'bomblet';
        bomblet._verb = 'cluster_munition';
        bomblet.bornAt = performance.now();
        bomblet.lifeMs = BOMBLET_LIFE_MS;
        if (s.igniteBomblets) bomblet._thermite = true;
        bomblet.onHit = (bb, _w, c2) => {
          c2.hitStop?.projSmall();   // a fan must NEVER lock the sim
          explode(c2, bb.position.x, bb.position.y, {
            radius: s.subRadius, baseVel: s.subBaseVel, upBias: 3,
            moodDelta: -s.subMood, stunMs: 400, shake: 8, sound: 'bomb', limpMs: 350,
            igniteMs: s.igniteBomblets ? 1 : 0,
            fireDuration: s.igniteBomblets ? s.fireDuration : 0,
          });
        };
        const jitter = (Math.random() - 0.5) * 1.5;
        Body.setVelocity(bomblet, { x: ca * s.spreadVel + jitter, y: sa * s.spreadVel });
        Composite.add(ctx2.world, bomblet);
        ctx2.transientBodies.push(bomblet);
      }
      sfx.clusterPop?.();
    };
    Composite.add(world, canister);
    ctx.transientBodies.push(canister);
  },
  drawCursor(ctx, { x, y, isDown, dragStart, gravityY = 1.4 }) {
    ctx.save();
    ctx.translate(x, y);
    // Fatter shell with a seam line (distinguishes it from the frag pineapple).
    ctx.fillStyle = '#39424a';
    ctx.beginPath(); ctx.ellipse(0, 0, 7, 10, 0, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#1f262b';
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(-7, 0); ctx.lineTo(7, 0); ctx.stroke();   // seam
    ctx.fillStyle = '#888';
    ctx.fillRect(-2, -13, 4, 4);   // nose fuse
    ctx.restore();

    if (!isDown || !dragStart) return;
    const dx = x - dragStart.x;
    const dy = y - dragStart.y;
    if (Math.hypot(dx, dy) < 24) return;
    const k = 0.04;
    const vx = Math.max(-15, Math.min(15, dx * k));
    const vy = Math.max(-18, Math.min(15, dy * k - 4));
    const a = gravityY * 0.001 * (1000 / 16);
    ctx.save();
    ctx.fillStyle = 'rgba(150, 170, 190, 0.55)';
    for (let step = 1; step <= 26; step++) {
      const t = step * 60;
      const px = dragStart.x + vx * t;
      const py = dragStart.y + vy * t + 0.5 * a * t * t * 0.0001 * 60;
      if (step % 2 === 0) {
        ctx.beginPath();
        ctx.arc(px, py, 2, 0, Math.PI * 2);
        ctx.fill();
      }
      if (py > 4000) break;
    }
    ctx.strokeStyle = 'rgba(150, 170, 190, 0.4)';
    ctx.setLineDash([2, 4]);
    ctx.beginPath();
    ctx.moveTo(dragStart.x, dragStart.y);
    ctx.lineTo(x, y);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();
  },
};
