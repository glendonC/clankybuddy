// Meteor shower, siege (weather barrage). A staggered AREA barrage of flaming
// rocks fired on the shared scheduler (S4) — the 2nd consumer of state/scheduler.js.
//
// Each step spawns a 'meteor' transient INLINE (not spawnDrop — spawnDrop's onHit
// is an anvil squash + stun + goLimp, never an explode, and has no fireDuration
// knob). The rock falls onto the cast-time floor plane and detonates with fire via
// explode({igniteMs}). Mirrors creeping-barrage's scheduler use, but spread over an
// AREA (not a forward line) and a fire-burst (not a shell blast).
//
// SCHEDULER CONTRACT: apply() captures cast-time geometry (posX[], markY) in the
// stepFn closure; the scheduler hands a FRESH per-step ctx (current ragdoll/epoch)
// and cancels the task on a character switch. The closure never reads ctx.x/ctx.y
// (the fresh ctx has none) and never closes over a live ragdoll. NO onExpire: the
// floor plane guarantees onHit fires (Pattern-1), and onExpire isn't epoch-gated,
// so we avoid that path entirely.

import Matter from 'matter-js';
import { sfx } from '../../audio/sfx.js';
import { spikeFear } from '../../mood.js';
import { startCooldown } from '../../ui/hotbar.js';
import { getStats } from '../_stats.js';
import { explode } from '../_shared.js';
import { scheduleSequence } from '../../state/scheduler.js';

const { Body, Bodies, Composite } = Matter;

export const defaultStats = {
  count:        6,
  intervalMs:   240,
  startDelayMs: 550,    // telegraph window — roar + cower before the first rock
  spreadW:      300,    // width of the impact zone around the mark
  radius:       140,    // blast radius per meteor
  baseVel:      11,
  mood:         14,
  igniteMs:     1600,
  fireDuration: 0,      // Impact craters upgrade adds a lingering fire pool
  dropHeight:   760,
  fallVel:      11,
};

// One flaming rock dropping onto the marked plane at columnX.
function spawnMeteor(ctx, columnX, markY) {
  const s = getStats('meteor_shower');
  const { world, transientBodies } = ctx;
  const rock = Bodies.circle(columnX, markY - s.dropHeight, 13, {
    frictionAir: 0, friction: 0, density: 0.01, restitution: 0,
    label: 'meteor', render: { visible: false },
  });
  rock.partType = 'meteor';
  rock._verb = ctx._verb || 'meteor_shower';
  rock.bornAt = performance.now();
  rock.lifeMs = 2600;
  Body.setVelocity(rock, { x: 0, y: s.fallVel });
  rock.onHit = (b, _world, ctx2) => {
    ctx2.hitStop?.projSmall();            // light tier — 6 in a row mustn't lock the sim
    explode(ctx2, b.position.x, b.position.y, {
      radius: s.radius, baseVel: s.baseVel, upBias: 4, moodDelta: -s.mood,
      stunMs: 600, shake: 12, igniteMs: s.igniteMs, fireDuration: s.fireDuration,
      sound: 'rocketBoom', limpMs: 450,
    });
  };
  Composite.add(world, rock);
  transientBodies.push(rock);
}

export default {
  id: 'meteor_shower',
  defaultStats,
  apply(ctx) {
    const s = getStats('meteor_shower');
    const { x, y, ragdoll, mood } = ctx;
    if (!ragdoll?.parts?.length) return;
    startCooldown('meteor_shower');
    sfx.meteor();
    spikeFear(mood, 70);

    // Cast-time impact columns: an even index spread across spreadW + jitter to
    // break the grid. Geometry is fixed at cast; the barrage does NOT re-track the
    // buddy (mirrors creeping-barrage — a re-tracking barrage would be a homing strike).
    const markY = y;
    const posX = [];
    for (let i = 0; i < s.count; i++) {
      const spread = s.count > 1 ? ((i / (s.count - 1)) - 0.5) * s.spreadW : 0;
      posX.push(x + spread + (Math.random() - 0.5) * 70);
    }
    scheduleSequence(
      (stepCtx, i) => spawnMeteor(stepCtx, posX[i], markY),
      { count: s.count, intervalMs: s.intervalMs, startDelayMs: s.startDelayMs },
    );
  },
  drawCursor(rctx, { x, y }) {
    const s = getStats('meteor_shower');
    const half = s.spreadW / 2;
    rctx.save();
    // dashed impact-zone bracket spanning the spread
    rctx.strokeStyle = 'rgba(255,120,60,0.4)'; rctx.lineWidth = 1.5; rctx.setLineDash([5, 4]);
    rctx.beginPath();
    rctx.moveTo(x - half, y + 14); rctx.lineTo(x - half, y + 6);
    rctx.lineTo(x + half, y + 6);  rctx.lineTo(x + half, y + 14);
    rctx.stroke();
    rctx.setLineDash([]);
    // a few inbound rock pips above the zone
    rctx.globalCompositeOperation = 'lighter';
    rctx.fillStyle = 'rgba(255,150,60,0.8)';
    for (let i = 0; i < 3; i++) {
      const px = x - half + ((i + 0.5) / 3) * s.spreadW;
      const py = y - 40 - i * 18;
      rctx.beginPath(); rctx.arc(px, py, 3, 0, Math.PI * 2); rctx.fill();
    }
    rctx.restore();
  },
};
