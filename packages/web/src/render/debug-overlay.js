// Dev-only debug overlay. Renders body ids, constraint anchors, status
// registry, and the live-mode panic meter. Toggled via settings.debugOverlay.

import Matter from 'matter-js';
import { getStatus } from '../effects/registry.js';
import { getLiveState } from '../live/index.js';

const { Composite } = Matter;

const STATUS_IDS = ['concussed', 'on_fire', 'electrified', 'frozen', 'powered', 'in_blackhole'];

export function renderDebugOverlay(ctx, ragdoll, status, transientBodies) {
  ctx.save();
  ctx.font = '10px "SF Mono", monospace';
  ctx.textBaseline = 'top';

  if (ragdoll) {
    // Body ids + statuses
    for (const p of ragdoll.parts) {
      const r = p.circleRadius || 16;
      ctx.strokeStyle = 'rgba(125, 211, 252, 0.55)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(p.position.x, p.position.y, r, 0, Math.PI * 2);
      ctx.stroke();

      ctx.fillStyle = 'rgba(125, 211, 252, 0.85)';
      ctx.fillText(`${p.label}#${p.id}`, p.position.x + r + 4, p.position.y - 6);

      const active = STATUS_IDS.filter(id => getStatus(status, p, id));
      if (active.length) {
        ctx.fillStyle = 'rgba(255, 200, 100, 0.95)';
        ctx.fillText(active.join(','), p.position.x + r + 4, p.position.y + 6);
      }
    }

    // Constraint anchors
    const constraints = Composite.allConstraints(ragdoll.composite);
    ctx.strokeStyle = 'rgba(248, 113, 113, 0.4)';
    ctx.lineWidth = 1;
    for (const c of constraints) {
      const a = anchorPos(c.bodyA, c.pointA);
      const b = anchorPos(c.bodyB, c.pointB);
      if (!a || !b) continue;
      ctx.beginPath();
      ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y);
      ctx.stroke();
    }
  }

  // Transient body classes
  for (const b of transientBodies) {
    if (!b.position) continue;
    ctx.fillStyle = 'rgba(168, 85, 247, 0.85)';
    ctx.fillText(b.partType || '?', b.position.x + 6, b.position.y - 12);
  }

  // Panic meter, buddy behavior is always live now, so the readout is always visible
  {
    const ls = getLiveState();
    const x = 12, y = 12, w = 160, h = 6;
    ctx.fillStyle = 'rgba(20,22,28,0.85)';
    ctx.fillRect(x - 4, y - 12, w + 8, h + 26);
    ctx.fillStyle = '#aaa';
    ctx.fillText('panic', x, y - 10);
    ctx.fillStyle = 'rgba(80,80,90,0.6)';
    ctx.fillRect(x, y, w, h);
    const fill = Math.min(1, ls.panic);
    ctx.fillStyle = fill > 0.7 ? '#f87171' : fill > 0.4 ? '#fbbf24' : '#34d399';
    ctx.fillRect(x, y, w * fill, h);
    ctx.fillStyle = '#aaa';
    ctx.fillText(`walk=${ls.walkDir > 0 ? '→' : '←'}`, x, y + 12);
  }

  ctx.restore();
}

function anchorPos(body, p) {
  if (!body) return null;
  const c = Math.cos(body.angle), s = Math.sin(body.angle);
  return {
    x: body.position.x + (c * p.x - s * p.y),
    y: body.position.y + (s * p.x + c * p.y),
  };
}
