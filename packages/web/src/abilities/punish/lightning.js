import Matter from 'matter-js';
import * as P from '../../particles.js';
import { sfx } from '../../audio/sfx.js';
// mood + speech via ctx.reactTo.
import { stun } from '../../physics/stand.js';
import { applyStatus, hasStatus, getStatus, isBrittle } from '../../effects/registry.js';
import { showFlash, showCombo } from '../../ui/overlays.js';
import { getStats } from '../_stats.js';
import { nearestPart, applyImpulse, combust, shatter } from '../_shared.js';

const { Body } = Matter;

export const defaultStats = {
  chainTargets:    3,        // arc-zap to this many neighboring parts
  forkChance:      0.55,     // (1 - skipChance) per mid-vertex
  mood:            14,       // base damage (subtracted)
  electrifiedMs:   700,
  overclockBonus:  30,       // mood gain when OVERCLOCK fires
  shake:           20,
};

// Spawns a jagged polyline of spark particles between (x0, y0) and (x1, y1)
// with mid-segment perpendicular jitter, simulating a Lichtenberg fork.
// Returns the joint coordinates so callers can spawn forks at intermediate vertices.
function spawnBolt(x0, y0, x1, y1, segs = 10, jitterPx = 28, color = '#dff7ff', life = 320) {
  const points = [{ x: x0, y: y0 }];
  const dx = x1 - x0, dy = y1 - y0;
  const len = Math.hypot(dx, dy) || 1;
  const px = -dy / len, py = dx / len;  // perpendicular unit vector
  for (let i = 1; i < segs; i++) {
    const t = i / segs;
    // jitter shrinks toward the strike point so the bolt narrows to a point.
    const jitter = jitterPx * (1 - 0.6 * t) * (Math.random() - 0.5) * 2;
    points.push({
      x: x0 + dx * t + px * jitter,
      y: y0 + dy * t + py * jitter,
    });
  }
  points.push({ x: x1, y: y1 });
  // emit a thick spark at each vertex + a few in-between sparks
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    P.spawn({ x: p.x, y: p.y, vx: 0, vy: 0, type: 'spark', color: '#fff', size: 5, life: life * 0.6, gravity: 0, drag: 1 });
    P.spawn({ x: p.x, y: p.y, vx: 0, vy: 0, type: 'spark', color, size: 9, life, gravity: 0, drag: 1 });
    if (i < points.length - 1) {
      const q = points[i + 1];
      const stitchN = 4;
      for (let j = 1; j < stitchN; j++) {
        const ts = j / stitchN;
        P.spawn({
          x: p.x + (q.x - p.x) * ts,
          y: p.y + (q.y - p.y) * ts,
          vx: 0, vy: 0, type: 'spark', color: '#9be7ff', size: 3, life: life * 0.5,
          gravity: 0, drag: 1,
        });
      }
    }
  }
  return points;
}

export default {
  id: 'lightning',
  defaultStats,
  apply(ctx) {
    const s = getStats('lightning');
    const { ragdoll, mood, status, x, y, popBubble, screenShake } = ctx;
    const part = nearestPart(ragdoll, x, y);
    if (!part) return;

    // KO REVIVE, canonical IB-1 mechanic. If buddy is knocked out, lightning
    // shocks them back to life instead of dealing damage. Phase 7, gated
    // behind a 4s cooldown so spam-revive isn't an unbounded heal button.
    const REVIVE_CD_MS = 4000;
    const now = performance.now();
    if (ragdoll.koUntil && now < ragdoll.koUntil &&
        now - (mood._lastReviveAt || 0) > REVIVE_CD_MS) {
      mood._lastReviveAt = now;
      ragdoll.koUntil = 0;
      ragdoll.stunUntil = 0;
      // Revive is a positive event keyed to the 'revive' pool (falls back to
      // mood-state speech if persona doesn't define it). '*gasp*' below
      // stays as the canonical scripted bubble.
      ctx.reactTo?.({ source: 'revive', part, moodDelta: 35, speakMs: 99999 });
      const skyX = part.position.x;
      spawnBolt(skyX, -20, part.position.x, part.position.y, 11, 36, '#5cf2a0', 420);
      P.burst(part.position.x, part.position.y, 30, { type: 'star', color: '#5cf2a0', size: 5, life: 900, speedRange: 1.4 });
      P.burst(part.position.x, part.position.y, 18, { type: 'spark', color: '#fff', size: 3, life: 320, speedRange: 1.4 });
      sfx.zap();
      screenShake(s.shake * 0.5, 200);
      showCombo?.('REVIVED', '#5cf2a0');
      popBubble?.(ragdoll.head, '*gasp*');
      return;
    }

    // Combust EVERY burning part (Pass C fix preserved here).
    for (const p of ragdoll.parts) {
      if (hasStatus(status, p, 'on_fire')) combust(ctx, p);
    }
    // SHOCK SHATTER: any frozen part shatters on lightning contact.
    let shocked = false;
    for (const p of ragdoll.parts) {
      if (isBrittle(status, p)) { shatter(ctx, p); shocked = true; }
    }
    // OVERCLOCK: any powered part → lightning HEALS instead of damages.
    let overclocked = false;
    for (const p of ragdoll.parts) {
      if (hasStatus(status, p, 'powered')) {
        overclocked = true;
        const rec = getStatus(status, p, 'powered');
        if (rec) rec.expiresAt = Math.max(rec.expiresAt, performance.now() + 3000);
      }
    }
    if (overclocked) {
      // OVERCLOCK pool key, speech suppressed since the combo overlay below
      // covers the visual feedback.
      ctx.reactTo?.({ source: 'overclock', part, moodDelta: s.overclockBonus, speakMs: 99999 });
      P.burst(part.position.x, part.position.y, 30, { type: 'star',  color: '#5cf2a0', size: 5, life: 900,  speedRange: 1.6 });
      P.burst(part.position.x, part.position.y, 18, { type: 'spark', color: '#9be7ff', size: 3, life: 350, speedRange: 1.0 });
      showCombo?.('OVERCLOCK', '#5cf2a0');
    }
    if (shocked && !overclocked) showCombo?.('SHOCK SHATTER', '#9be7ff');

    // 1. Sky-to-target main bolt (drops from above stage).
    const skyX = part.position.x + (Math.random() - 0.5) * 60;
    const points = spawnBolt(skyX, -20, part.position.x, part.position.y, 11, 36, '#dff7ff', 360);

    // 2. Branching forks at random mid-vertices.
    for (let i = 2; i < points.length - 1; i++) {
      if (Math.random() > s.forkChance) continue;
      const root = points[i];
      const angle = Math.random() * Math.PI * 2;
      const forkLen = 60 + Math.random() * 50;
      const tx = root.x + Math.cos(angle) * forkLen;
      const ty = root.y + Math.sin(angle) * forkLen;
      spawnBolt(root.x, root.y, tx, ty, 5, 14, '#9be7ff', 260);
    }

    // 3. Arc-zap to neighboring parts.
    const others = ragdoll.parts.filter(p => p !== part);
    others.sort((a, b) =>
      Math.hypot(a.position.x - part.position.x, a.position.y - part.position.y) -
      Math.hypot(b.position.x - part.position.x, b.position.y - part.position.y));
    for (const n of others.slice(0, s.chainTargets)) {
      spawnBolt(part.position.x, part.position.y, n.position.x, n.position.y, 6, 14, '#9be7ff', 240);
    }

    // 4. Impact starburst at the strike point.
    P.burst(part.position.x, part.position.y, 28, { type: 'spark', color: '#9be7ff', size: 4, life: 420, speedRange: 1.4 });
    P.burst(part.position.x, part.position.y, 14, { type: 'spark', color: '#fff',    size: 3, life: 220, speedRange: 1.8 });
    P.burst(part.position.x, part.position.y, 10, { type: 'smoke', color: '#cdd',    size: 8, life: 700, speedRange: 0.4, gravity: -0.0004 });

    // 5. Status + impulse + stun.
    const fx = (Math.random() - 0.5) * 0.05;
    const fy = -0.06;
    applyImpulse(part, fx, fy);
    for (const p of ragdoll.parts) {
      Body.setAngularVelocity(p, (Math.random() - 0.5) * 0.6);
      applyStatus(status, p, 'electrified', { duration: s.electrifiedMs, source: 'lightning' });
    }
    if (!overclocked) {
      ctx.reactTo?.({ source: 'lightning', part, moodDelta: -s.mood, impulse: Math.hypot(fx, fy), speakMs: 500 });
    }
    stun(ragdoll, 600);

    // 6. Audio + visceral shake + screen flash.
    sfx.zap();
    screenShake(s.shake, 350);
    ctx.hitStop?.(50, 0.05);
    showFlash('#ffffff', 90, 0.7);
  },
  drawCursor(ctx, { x, y, target }) {
    ctx.save();
    ctx.translate(x, y);
    ctx.fillStyle = '#3a4452';
    for (const o of [{ x: -8, y: -2, r: 7 }, { x: 0, y: -4, r: 8 }, { x: 8, y: -1, r: 7 }]) {
      ctx.beginPath(); ctx.arc(o.x, o.y, o.r, 0, Math.PI * 2); ctx.fill();
    }
    ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = '#9be7ff';
    ctx.beginPath();
    ctx.moveTo(-2, 4); ctx.lineTo(3, 4); ctx.lineTo(0, 9); ctx.lineTo(5, 9);
    ctx.lineTo(-2, 18); ctx.lineTo(2, 11); ctx.lineTo(-3, 11); ctx.closePath();
    ctx.fill();
    ctx.restore();
    if (target) {
      ctx.save();
      ctx.strokeStyle = 'rgba(155, 231, 255, 0.25)';
      ctx.setLineDash([2, 6]);
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x, y + 10);
      ctx.lineTo(target.position.x, target.position.y);
      ctx.stroke();
      ctx.restore();
    }
  },
};
