// Mortar, ordnance. Click marks the ground; after a brief incoming whistle a
// shell falls from offscreen-above the mark and detonates with a full explode()
// blast (Pattern-1 ad-hoc onHit, fires on the first collision incl. the floor).
//
// The whistle->spawn delay is an epoch-guarded setTimeout (the nuke.js idiom):
// if the player switches characters mid-whistle, the captured epoch no longer
// validates and the shell never spawns on the new buddy.

import Matter from 'matter-js';
import { sfx } from '../../audio/sfx.js';
import { spikeFear } from '../../mood.js';
import { startCooldown } from '../../ui/hotbar.js';
import { getStats } from '../_stats.js';
import { explode } from '../_shared.js';

const { Body, Bodies, Composite } = Matter;

export const defaultStats = {
  radius:     240,
  baseVel:    16,
  mood:       32,
  igniteMs:   2500,
  whistleMs:  800,
  dropHeight: 720,
  fallVel:    13,
};

export default {
  id: 'mortar',
  defaultStats,
  apply(ctx) {
    const s = getStats('mortar');
    const { x, y, mood } = ctx;
    startCooldown('mortar');
    // Telegraph fires synchronously (epoch-independent): incoming whistle + the
    // buddy cowers while the round is inbound.
    sfx.mortarWhistle();
    spikeFear(mood, 70);
    const epoch = ctx._epoch;
    setTimeout(() => {
      if (!ctx._epochValid?.(epoch)) return;
      const { world, transientBodies } = ctx;
      const shell = Bodies.rectangle(x, y - s.dropHeight, 20, 10, {
        frictionAir: 0, friction: 0, density: 0.006, restitution: 0,
        label: 'mortar_shell', render: { visible: false },
      });
      shell.partType = 'mortar_shell';
      shell._verb = ctx._verb || 'mortar';
      shell.bornAt = performance.now();
      shell.lifeMs = 2400;
      Body.setAngle(shell, Math.PI / 2);    // nose-down (the render branch rotates by b.angle)
      Body.setVelocity(shell, { x: 0, y: s.fallVel });
      shell.onHit = (b, _world, ctx2) => {
        ctx2.hitStop?.projBig();
        explode(ctx2, b.position.x, b.position.y, {
          radius: s.radius, baseVel: s.baseVel, upBias: 5, moodDelta: -s.mood,
          stunMs: 1400, shake: 22, igniteMs: s.igniteMs, sound: 'rocketBoom', limpMs: 850,
        });
      };
      shell.onExpire = (b, ctx2) => {
        // Airburst safety if it somehow never collides within lifeMs.
        explode(ctx2, b.position.x, b.position.y, {
          radius: s.radius * 0.85, baseVel: s.baseVel * 0.82, upBias: 4, moodDelta: -s.mood * 0.7,
          stunMs: 1100, shake: 18, igniteMs: s.igniteMs * 0.75, sound: 'rocketBoom', limpMs: 700,
        });
      };
      Composite.add(world, shell);
      transientBodies.push(shell);
    }, s.whistleMs);
  },
  drawCursor(ctx, { x, y }) {
    // Ground target reticle: a shell pip + dashed impact ring at the mark.
    ctx.save();
    ctx.translate(x, y);
    ctx.fillStyle = '#3a4038';
    ctx.fillRect(-3, -8, 6, 12);
    ctx.fillStyle = '#1c201b';
    ctx.beginPath(); ctx.moveTo(-3, -8); ctx.lineTo(0, -13); ctx.lineTo(3, -8); ctx.closePath(); ctx.fill();
    ctx.restore();
    ctx.save();
    ctx.strokeStyle = 'rgba(255, 120, 60, 0.4)';
    ctx.setLineDash([4, 4]);
    ctx.beginPath(); ctx.arc(x, y + 14, 18, 0, Math.PI * 2); ctx.stroke();
    ctx.restore();
  },
};
