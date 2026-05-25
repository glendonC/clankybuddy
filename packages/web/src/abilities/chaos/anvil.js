import Matter from 'matter-js';
import * as P from '../../particles.js';
import { sfx } from '../../audio/sfx.js';
import { spikeFear } from '../../mood.js';
import { stun, goLimp } from '../../physics/stand.js';
import { isBrittle } from '../../effects/registry.js';
import { showAnvilDrop } from '../../ui/overlays.js';
import { startCooldown } from '../../ui/hotbar.js';
import { spawnImpactDust } from '../../render/stage.js';
import { getStats } from '../_stats.js';
import { nearestPart, shatter } from '../_shared.js';

const { Body, Bodies, Composite } = Matter;

export const defaultStats = {
  density: 0.02,    // body density, paired with cataclysm.js Heavier-anvil upgrade
  mood:    30,      // mood damage on impact (positive; subtracted)
};

export default {
  id: 'anvil',
  defaultStats,
  apply(ctx) {
    const s = getStats('anvil');
    const { world, x, y, mood } = ctx;
    startCooldown('anvil');
    showAnvilDrop(x, y);
    // Telegraphed threat, spike fear so the buddy cowers while it falls.
    spikeFear(mood, 70);
    const a = Bodies.rectangle(x, y - 700, 96, 56, {
      density: s.density, restitution: 0.05, friction: 0.9,
      label: 'anvil', render: { visible: false },
    });
    a.partType = 'anvil';
    a._verb = ctx._verb || 'anvil';
    a.bornAt = performance.now();
    a.lifeMs = 3000;
    a.onHit = (b, world, ctx2) => {
      if (b._didAnvilHit) return; b._didAnvilHit = true;
      const part = nearestPart(ctx2.ragdoll, b.position.x, b.position.y);
      if (part) {
        if (isBrittle(ctx2.status, part)) shatter(ctx2, part);
        // Anvil is a vertical squash, big downward velocity on the impacted
        // part, modest splash on neighbors so the whole figure gets pancaked.
        Body.setVelocity(part, { x: part.velocity.x, y: part.velocity.y + 22 });
        for (const other of ctx2.ragdoll.parts) {
          if (other === part) continue;
          const dx = other.position.x - part.position.x;
          const dy = other.position.y - part.position.y;
          const d = Math.hypot(dx, dy) || 1;
          if (d < 140) {
            const f = (1 - d / 140) * 8;
            Body.setVelocity(other, {
              x: other.velocity.x + (dx / d) * f,
              y: other.velocity.y + (dy / d) * f * 0.4 + 4,
            });
          }
        }
      }
      const moodDelta = -s.mood;
      if (part) {
        ctx2.reactTo?.({ source: 'anvil', part, moodDelta, impulse: 22, speakMs: 700 });
      } else {
        ctx2.reactTo?.({ source: 'anvil', moodDelta, speakMs: 99999 });
      }
      stun(ctx2.ragdoll, 1200);
      goLimp(ctx2.ragdoll, 700);
      ctx2.screenShake(28, 700);          // bumped from 18, mega tier
      ctx2.hitStop?.mega();
      // Crater: dense smoke ring + dust kicked up from the floor.
      P.burst(b.position.x, b.position.y, 24, { type: 'smoke', color: '#222',    size: 20, life: 900,  speedRange: 0.7, gravity: -0.0004 });
      P.burst(b.position.x, b.position.y, 14, { type: 'spark', color: '#ffae3c', size: 3,  life: 350,  speedRange: 1.0 });
      P.burst(b.position.x, b.position.y, 10, { type: 'spark', color: '#fff',    size: 4,  life: 220,  speedRange: 1.6 });
      spawnImpactDust(b.position.x, b.position.y, 12);
      // Metallic CLANG: shatter SFX has the right high-freq sizzle to layer
      // on top of the bomb thud baked into sfx.anvil. Distinguishes anvil
      // from a generic explosion.
      sfx.shatter();
    };
    // Phase 7, let gravity accelerate the fall (audit #64). The previous
    // fixed y=18 was constant velocity, which read as a paste-on. Lower
    // initial velocity + gravity buildup gives the proper "wait for it"
    // anticipation. Density × gravity provides the punch on landing.
    Body.setVelocity(a, { x: 0, y: 4 });
    Composite.add(world, a);
    ctx.transientBodies.push(a);
    sfx.anvil();
  },
  drawCursor(ctx, { x, y }) {
    ctx.save();
    ctx.translate(x, y);
    ctx.fillStyle = '#0e0e10';
    ctx.fillRect(-14, -7, 28, 14);
    ctx.fillStyle = '#222';
    ctx.fillRect(-12, -10, 24, 3);
    ctx.restore();
    ctx.save();
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.25)';
    ctx.setLineDash([4, 4]);
    ctx.beginPath(); ctx.arc(x, y + 18, 18, 0, Math.PI * 2); ctx.stroke();
    ctx.restore();
  },
};
