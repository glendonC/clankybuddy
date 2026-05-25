import * as P from '../../particles.js';
import { sfx } from '../../audio/sfx.js';
// mood + speech via ctx.reactTo.
import { isBrittle, damageMul, consumeConcussed } from '../../effects/registry.js';
import { applyImpulse, shatter } from '../_shared.js';

// Tool id 'sword'. Called continuously while held (kind: 'hold+drag', 50ms throttle).
// Damage zone is the full visible blade segment, not a circle around the hilt.
const BLADE_OFFSET   = 8;     // hilt → blade-base (matches drawCursor)
const BLADE_LEN_IDLE = 100;
const BLADE_LEN_DOWN = 110;
const HIT_RADIUS     = 28;    // perpendicular distance from blade to part center

// Distance from point P to segment AB (returns nearest-point + distance).
function segmentDistance(px, py, ax, ay, bx, by) {
  const abx = bx - ax, aby = by - ay;
  const apx = px - ax, apy = py - ay;
  const lenSq = abx * abx + aby * aby || 1;
  let t = (apx * abx + apy * aby) / lenSq;
  t = Math.max(0, Math.min(1, t));
  const cx = ax + abx * t, cy = ay + aby * t;
  return { dist: Math.hypot(px - cx, py - cy), t };
}

export default {
  id: 'sword',
  apply(ctx) {
    const { ragdoll, status, x, y, screenShake } = ctx;
    // Aim the blade at the nearest part, same vector drawCursor uses.
    let nearest = null, nearestD = Infinity;
    for (const p of ragdoll.parts) {
      const d = Math.hypot(p.position.x - x, p.position.y - y);
      if (d < nearestD) { nearestD = d; nearest = p; }
    }
    if (!nearest) return;
    const angle = Math.atan2(nearest.position.y - y, nearest.position.x - x);
    const isDown = true;  // we're firing, so blade is "extended"
    const bladeLen = isDown ? BLADE_LEN_DOWN : BLADE_LEN_IDLE;
    const ax = x + Math.cos(angle) * BLADE_OFFSET;
    const ay = y + Math.sin(angle) * BLADE_OFFSET;
    const bx = x + Math.cos(angle) * (BLADE_OFFSET + bladeLen);
    const by = y + Math.sin(angle) * (BLADE_OFFSET + bladeLen);

    let anyHit = false;
    for (const part of ragdoll.parts) {
      const seg = segmentDistance(part.position.x, part.position.y, ax, ay, bx, by);
      if (seg.dist > HIT_RADIUS) continue;
      anyHit = true;
      // Brittle (frozen) parts shatter from the blade.
      if (isBrittle(status, part)) shatter(ctx, part);
      // Directional knockback: perpendicular to the blade (pushes part along
      // the swing direction). Add a small along-blade slice component too.
      const F = 0.04 * part.mass;
      const perpX = -Math.sin(angle), perpY = Math.cos(angle);
      // Choose perpendicular sign so we push the part away from the blade line
      // (positive side of segment → +perp, negative → -perp).
      const sideSign = ((part.position.x - ax) * perpX + (part.position.y - ay) * perpY) >= 0 ? 1 : -1;
      const fx = perpX * F * sideSign + Math.cos(angle) * F * 0.3;
      const fy = perpY * F * sideSign + Math.sin(angle) * F * 0.3 - F * 0.15;
      applyImpulse(part, fx, fy);
      // CONCUSSED consume, sword tick is small but a concussed part eats a
      // boosted slice. Concussed naturally expires in 1500ms so spam-ticks
      // can't drain it without the tier-1 hit.
      const mul = damageMul(status, part);
      if (mul > 1) consumeConcussed(status, part);
      const moodDelta = -1.4 * mul;
      // Sword ticks fast (hold+drag), speech is gated by an outer 6% roll
      // below. Suppress reactTo's pool lookup here so it doesn't double-speak.
      ctx.reactTo?.({ source: 'sword', part, moodDelta, impulse: Math.hypot(fx, fy), speakMs: 99999 });
      // Slice particles along the blade
      P.spawn({ x: part.position.x, y: part.position.y, vx: 0, vy: 0,
        type: 'spark', color: '#9be7ff', size: 3, life: 220, gravity: 0, drag: 1 });
      for (let i = 0; i < 4; i++) {
        const a2 = angle + (Math.random() - 0.5) * 0.6;
        P.spawn({
          x: part.position.x + Math.cos(a2) * 4,
          y: part.position.y + Math.sin(a2) * 4,
          vx: Math.cos(a2 + Math.PI / 2 * sideSign) * 0.5,
          vy: Math.sin(a2 + Math.PI / 2 * sideSign) * 0.5 - 0.1,
          type: 'spark', color: '#fff', size: 2, life: 240, gravity: 0.0004,
        });
      }
    }
    if (!anyHit) return;
    // Audio: every fire (was 40%, felt sporadic).
    sfx.sword();
    screenShake(3, 120);
    // Roll-gated speak: occasional pool-keyed line, otherwise silent.
    if (Math.random() < 0.06) ctx.reactTo?.({ source: 'sword', part: nearest, moodDelta: 0, speakMs: 600 });
  },
  drawCursor(ctx, { x, y, angle, isDown }) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle);
    // hilt
    ctx.fillStyle = '#1c1c20';
    ctx.fillRect(-14, -3, 22, 6);
    ctx.fillStyle = '#aaa';
    ctx.fillRect(-2, -4, 3, 8);
    ctx.fillStyle = '#666';
    for (let i = -10; i < 8; i += 4) ctx.fillRect(i, -3, 1, 6);
    // blade, additive glow
    const bladeLen = isDown ? 110 : 100;
    ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = 'rgba(155, 231, 255, 0.35)';
    ctx.fillRect(8, -6, bladeLen, 12);
    ctx.fillStyle = 'rgba(155, 231, 255, 0.75)';
    ctx.fillRect(8, -3, bladeLen, 6);
    ctx.fillStyle = '#fff';
    ctx.fillRect(8, -1.5, bladeLen, 3);
    ctx.restore();
  },
};
