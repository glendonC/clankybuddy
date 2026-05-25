import Matter from 'matter-js';
import * as P from '../../particles.js';
import { sfx } from '../../audio/sfx.js';
import { spikeJoy } from '../../mood.js';
import { getStats } from '../_stats.js';

const { Body, Bodies, Composite } = Matter;

export const defaultStats = {
  mood:     4,    // mood gain on cast
  joySpike: 35,   // transient joy axis spike (decays fast, body language)
};

export default {
  id: 'feed',
  defaultStats,
  apply(ctx) {
    const s = getStats('feed');
    const { ragdoll, mood, world, x, y } = ctx;
    const treat = Bodies.circle(x, y - 30, 8, {
      restitution: 0.4, friction: 0.6, density: 0.0008,
      label: 'treat', render: { visible: false },
    });
    treat.partType = 'treat';
    treat._verb = ctx._verb || 'feed';
    treat.bornAt = performance.now();
    Composite.add(world, treat);
    ctx.transientBodies.push(treat);
    Body.setVelocity(treat, { x: (Math.random() - 0.5) * 1, y: -2 });
    spikeJoy(mood, s.joySpike);
    sfx.feed();
    P.burst(x, y - 30, 6, { type: 'spark', color: '#f2c45c', life: 400, speedRange: 0.2, gravity: 0.001 });
    ctx.reactTo?.({ source: 'feed', part: ragdoll.head, moodDelta: s.mood, speakMs: 800 });
  },
  drawCursor(ctx, { x, y }) {
    ctx.save();
    ctx.translate(x, y);
    ctx.fillStyle = '#c98a4b';
    ctx.beginPath(); ctx.arc(0, 0, 9, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#5b3825';
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      ctx.beginPath(); ctx.arc(Math.cos(a) * 4, Math.sin(a) * 4, 1.5, 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();
  },
};
