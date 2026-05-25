import Matter from 'matter-js';
import * as P from '../../particles.js';
import { sfx } from '../../audio/sfx.js';
// applyMoodDelta + maybeSpeak now routed through ctx.reactTo.
import { stun } from '../../physics/stand.js';
import { isBrittle, hasStatus, damageMul, consumeConcussed, removeStatus } from '../../effects/registry.js';
import { showCombo } from '../../ui/overlays.js';
import { getStats } from '../_stats.js';
import { partInRange, applyImpulse, shatter } from '../_shared.js';
import { flinch } from '../../effects/_locomotion.js';
import { panicWindowActive } from '../../live/panic-state.js';

const { Vector } = Matter;

export const defaultStats = {
  range:   70,
  force:   0.05,    // multiplied by part.mass
  mood:    8,       // damage on connect (positive number; subtracted)
  stunMs:  350,
  shake:   6,
};

export default {
  id: 'punch',
  defaultStats,
  apply(ctx) {
    const s = getStats('punch');
    const { ragdoll, mood, status, x, y, popBubble, screenShake } = ctx;
    const part = partInRange(ragdoll, x, y, s.range);
    if (!part) {
      // whiff, quiet smoke puff. No fake hit-sound (Agent A: misses sounded
      // identical to connects).
      P.burst(x, y, 4, { type: 'smoke', color: '#666', size: 6, life: 280, speedRange: 0.25, gravity: -0.0002 });
      return;
    }
    if (isBrittle(status, part)) shatter(ctx, part);
    const dir = Vector.sub(part.position, { x, y });
    const norm = Vector.normalise(dir);
    // REJECTED combo: punching a powered part bounces the player off, half
    // damage, half force, +mood for the buddy ("haha you tried").
    const rejected = hasStatus(status, part, 'powered');
    const F = s.force * part.mass * (rejected ? 0.5 : 1);
    // Mass-scale the upward bias too, flat -0.02 yanked light arms over the head.
    const fx = norm.x * F;
    const fy = norm.y * F - 0.02 * part.mass;
    applyImpulse(part, fx, fy);
    // CONCUSSED consume, only when the hit actually deals damage (not REJECTED).
    const mul = rejected ? 1 : damageMul(status, part);
    if (mul > 1) consumeConcussed(status, part);
    // Phase 7, Counter branch is now mechanically distinct, not just a
    // stat tune. `s.counterBonusInPanic` (set by the Counter upgrade) gates
    // a 2× damage spike on hits landed during a panic window; outside the
    // window Counter still has its base force/shake bonus from the upgrade
    // but no damage cliff, that's the "trade-on-purpose" risk-reward.
    const counterBonus = (!rejected && s.counterBonusInPanic && panicWindowActive()) ? 2.0 : 1.0;
    if (counterBonus > 1) showCombo?.('COUNTER!', '#ffae3c');
    // Phase 7, Flurry capstone: hits within `flurryWindowMs` of the last
    // landed punch add `flurryStep` mood, capped at `flurryCap`. The B2
    // capstone (Flurry, kinetic.js) finally has a producer.
    let flurryBonus = 0;
    if (!rejected && s.flurryWindowMs && s.flurryStep && s.flurryCap) {
      mood.flurryState ??= { count: 0, lastAt: 0 };
      const now = performance.now();
      if (now - mood.flurryState.lastAt < s.flurryWindowMs) {
        mood.flurryState.count = Math.min(mood.flurryState.count + 1, s.flurryCap);
      } else {
        mood.flurryState.count = 1;
      }
      mood.flurryState.lastAt = now;
      flurryBonus = (mood.flurryState.count - 1) * s.flurryStep;
      if (mood.flurryState.count >= 4) showCombo?.(`FLURRY x${mood.flurryState.count}`, '#f25c5c');
    }
    const baseDamage = rejected ? +2 : -(s.mood * mul + flurryBonus) * counterBonus;
    // reactTo bundles applyMoodDelta + recordHit + shock auto-spike + pool-keyed
    // speech ("punch" pool in personas/<id>.js). Rejected hits stay tagged
    // 'punch' for telemetry but speak via the hardcoded 'haha' below.
    ctx.reactTo?.({ source: 'punch', part, moodDelta: baseDamage, impulse: Math.hypot(fx, fy), speakMs: 500 });
    // Phase 7, Riposte's stripBuffOnHit finally fires. Strips one `powered`
    // from any buddy part (or the targeted one if it has it). Doesn't strip
    // sycophancy_fed because that's a player-side buff that helps damage.
    if (!rejected && s.stripBuffOnHit) {
      let stripped = false;
      if (hasStatus(status, part, 'powered')) {
        removeStatus(status, part, 'powered', 'riposte');
        stripped = true;
      } else {
        for (const p of ragdoll.parts) {
          if (hasStatus(status, p, 'powered')) {
            removeStatus(status, p, 'powered', 'riposte');
            stripped = true;
            break;
          }
        }
      }
      if (stripped) showCombo?.('RIPOSTE', '#ff8a3c');
    }
    if (rejected) {
      showCombo?.('REJECTED', '#5cf2a0');
      popBubble(part, 'haha');
    }
    stun(ragdoll, s.stunMs);
    if (!rejected) flinch(ragdoll, x, y, 0.7);
    sfx.punch();
    screenShake(s.shake, 200);
    P.burst(part.position.x, part.position.y, 14, { type: 'spark', color: '#f25c5c', size: 3, life: 350, speedRange: 0.7 });
  },
  drawCursor(ctx, { x, y, angle, isDown }) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle);
    if (isDown) ctx.translate(6, 0);
    ctx.fillStyle = '#f5d4b8';
    ctx.strokeStyle = 'rgba(0,0,0,0.7)';
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.ellipse(0, 0, 10, 8, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#e3b89b';
    for (let i = -2; i <= 2; i++) {
      ctx.beginPath(); ctx.arc(2, i * 2.2, 1.5, 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();
  },
};
