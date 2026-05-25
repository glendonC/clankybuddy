import Matter from 'matter-js';
import * as P from '../../particles.js';
import { sfx } from '../../audio/sfx.js';
import { spikeJoy } from '../../mood.js';
import { getStats } from '../_stats.js';

const { Bodies, Composite } = Matter;

export const defaultStats = {
  mood:     10,   // mood gain on cast
  joySpike: 60,
};

export default {
  id: 'gift',
  defaultStats,
  apply(ctx) {
    const s = getStats('gift');
    const { ragdoll, mood, world, x, y } = ctx;
    const box = Bodies.rectangle(x, y - 40, 20, 20, {
      restitution: 0.3, density: 0.001, friction: 0.5, label: 'gift', render: { visible: false },
    });
    box.partType = 'gift';
    box._verb = ctx._verb || 'gift';
    box.bornAt = performance.now();
    Composite.add(world, box);
    ctx.transientBodies.push(box);
    spikeJoy(mood, s.joySpike);
    sfx.gift();
    P.burst(x, y - 40, 14, { type: 'star', color: '#f2c45c', size: 4, life: 900, speedRange: 0.4, gravity: -0.0002 });
    ctx.reactTo?.({ source: 'gift', part: ragdoll.head, moodDelta: s.mood, speakMs: 600 });
  },
  drawCursor(ctx, { x, y }) {
    ctx.save();
    ctx.translate(x, y);
    ctx.fillStyle = '#f25c8a';
    ctx.fillRect(-9, -9, 18, 18);
    ctx.fillStyle = '#f2c45c';
    ctx.fillRect(-9, -2, 18, 4);
    ctx.fillRect(-2, -9, 4, 18);
    ctx.restore();
  },
};
