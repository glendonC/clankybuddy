// Stage clear, leaves the canvas transparent so the CSS background (the
// character-accent radial in stage.css) shows through. The ragdoll and
// transient bodies render on top of the empty canvas.

import * as P from '../particles.js';
import { isFinitePart } from './ragdoll.js';
import { FLOOR_INSET } from '../physics/constants.js';

export function clearStage(ctx, w, h) {
  ctx.clearRect(0, 0, w, h);
}

// Floor band + per-buddy contact shadow. Anchors the buddy visually so it
// doesn't read as floating in mid-air. The band is a thin gradient along
// the floor; the shadow is a soft ellipse at floor level under the chest,
// tightening as the buddy descends and softening when he's mid-air.
// FLOOR_INSET is shared with state/world.js (floor wall) and
// state/ragdoll-lifecycle.js (spawn y), one source of truth.
export function renderFloor(ctx, w, h) {
  const floorY = h - FLOOR_INSET;
  ctx.save();
  // Subtle band so the eye reads a horizon line.
  const grad = ctx.createLinearGradient(0, floorY - 8, 0, floorY + 24);
  grad.addColorStop(0,   'rgba(0, 0, 0, 0)');
  grad.addColorStop(0.5, 'rgba(0, 0, 0, 0.18)');
  grad.addColorStop(1,   'rgba(0, 0, 0, 0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, floorY - 8, w, 32);
  ctx.restore();
}

export function renderContactShadow(ctx, ragdoll, w, h) {
  if (!ragdoll || !ragdoll.chest) return;
  const chest = ragdoll.chest;
  if (!isFinitePart(chest)) return;
  const floorY = h - FLOOR_INSET;
  const heightAbove = Math.max(0, floorY - chest.position.y);
  // Shadow shrinks as buddy gets higher; vanishes past ~360px above floor.
  const t = Math.max(0, 1 - heightAbove / 360);
  if (t <= 0.05) return;
  const rx = 60 * (0.6 + 0.4 * t);
  const ry = 8  * (0.5 + 0.5 * t);
  const alpha = 0.28 * t;
  ctx.save();
  ctx.fillStyle = `rgba(0, 0, 0, ${alpha})`;
  ctx.beginPath();
  ctx.ellipse(chest.position.x, floorY + 2, rx, ry, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

// Burst of dust at impact point, call from heavy ability handlers
// (anvil, etc). Lives on the existing particle layer.
export function spawnImpactDust(x, y, count = 6) {
  for (let i = 0; i < count; i++) {
    P.spawn({
      x: x + (Math.random() - 0.5) * 80,
      y: y + 4,
      vx: (Math.random() - 0.5) * 0.18,
      vy: -0.08 - Math.random() * 0.1,
      type: 'smoke', color: '#a8b0bc',
      size: 3 + Math.random() * 3,
      life: 900 + Math.random() * 300,
      gravity: -0.00005, drag: 0.995,
    });
  }
}
