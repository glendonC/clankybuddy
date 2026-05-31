// Creeping barrage, ordnance. A mortar fork that walks K smaller shells along a
// pre-set line marching THROUGH the buddy, fired on the shared scheduler (S4).
// The first consumer of state/scheduler.js.
//
// Reuses partType 'mortar_shell' (existing render branch) + explode() + the
// Pattern-1 ad-hoc onHit shape from mortar — spawns its own (smaller) shells
// inline, does NOT touch mortar.js. NO new render branch, NO new transient handler.
//
// SCHEDULER CONTRACT: the per-step closure captures the cast-time geometry
// (posX[], markY) and is handed a FRESH ctx per fired step by the scheduler.
// That's intentional — a barrage walks a pre-set line and must NOT re-track the
// buddy mid-sequence (that would be a homing strike). Geometry is cast-time;
// ragdoll/epoch is fire-time. The fresh ctx has no x/y/_verb, so markY is passed
// explicitly and each shell stamps its own _verb.

import Matter from 'matter-js';
import { sfx } from '../../audio/sfx.js';
import { spikeFear } from '../../mood.js';
import { startCooldown } from '../../ui/hotbar.js';
import { getStats } from '../_stats.js';
import { explode } from '../_shared.js';
import { scheduleSequence } from '../../state/scheduler.js';

const { Body, Bodies, Composite } = Matter;

export const defaultStats = {
  count:      4,
  intervalMs: 320,    // a shell every ~0.32s
  startDelayMs: 650,  // telegraph window — whistle + cower before the first shell
  stepX:      90,     // px between adjacent impacts along the line
  // SMALLER than mortar (240/16/32/2500) so K shells ≈ one mortar, spread wide.
  radius:     130,
  baseVel:    11,
  mood:       12,
  igniteMs:   1200,
  dropHeight: 720,    // reuse mortar's drop kinematics
  fallVel:    13,
};

// One falling shell at columnX, dropping onto the marked ground plane markY.
// Mirrors the mortar shell-drop pattern (nose-down 'mortar_shell', Pattern-1
// onHit/onExpire → explode) but with a smaller blast.
function spawnBarrageShell(ctx, columnX, markY) {
  const s = getStats('creeping_barrage');
  const { world, transientBodies } = ctx;
  const shell = Bodies.rectangle(columnX, markY - s.dropHeight, 16, 8, {
    frictionAir: 0, friction: 0, density: 0.005, restitution: 0,
    label: 'mortar_shell', render: { visible: false },
  });
  shell.partType = 'mortar_shell';          // reuse the existing render branch
  shell._verb = ctx._verb || 'creeping_barrage';
  shell.bornAt = performance.now();
  shell.lifeMs = 2400;
  Body.setAngle(shell, Math.PI / 2);        // nose-down (render rotates by b.angle)
  Body.setVelocity(shell, { x: 0, y: s.fallVel });
  shell.onHit = (b, _world, ctx2) => {
    ctx2.hitStop?.projSmall();              // lighter than mortar's projBig — 4 in a row mustn't lock the sim
    explode(ctx2, b.position.x, b.position.y, {
      radius: s.radius, baseVel: s.baseVel, upBias: 4, moodDelta: -s.mood,
      stunMs: 600, shake: 12, igniteMs: s.igniteMs, sound: 'rocketBoom', limpMs: 450,
    });
  };
  shell.onExpire = (b, ctx2) => {
    explode(ctx2, b.position.x, b.position.y, {
      radius: s.radius * 0.85, baseVel: s.baseVel * 0.82, upBias: 4, moodDelta: -s.mood * 0.7,
      stunMs: 450, shake: 10, igniteMs: s.igniteMs * 0.75, sound: 'rocketBoom', limpMs: 380,
    });
  };
  Composite.add(world, shell);
  transientBodies.push(shell);
}

export default {
  id: 'creeping_barrage',
  defaultStats,
  apply(ctx) {
    const s = getStats('creeping_barrage');
    const { x, y, ragdoll, mood } = ctx;
    if (!ragdoll?.parts?.length) return;
    startCooldown('creeping_barrage');
    // Telegraph fires synchronously (epoch-independent), like mortar: whistle + cower.
    sfx.mortarWhistle();
    spikeFear(mood, 70);

    // Walk the line from the mark TOWARD + through the buddy centroid. Direction
    // is resolved at CAST time; the fired sequence walks the FIXED columns.
    let cx = 0; for (const p of ragdoll.parts) cx += p.position.x; cx /= ragdoll.parts.length;
    const dir = Math.sign(cx - x) || 1;
    const markY = y;
    const posX = [];
    for (let i = 0; i < s.count; i++) posX.push(x + dir * i * s.stepX);

    // Closure captures posX[]/markY (cast-time geometry); the scheduler hands a
    // fresh ctx per fire (current ragdoll/epoch) + cancels if the buddy swaps.
    scheduleSequence(
      (stepCtx, i) => spawnBarrageShell(stepCtx, posX[i], markY),
      { count: s.count, intervalMs: s.intervalMs, startDelayMs: s.startDelayMs },
    );
  },
  drawCursor(rctx, { x, y, target }) {
    // Marked line: a row of shell pips walking toward the buddy + a dashed impact
    // ring at the mark. Direction comes from `target` (renderToolCursor passes
    // nearestPart, on the buddy side) — drawCursor has no ragdoll.
    const s = getStats('creeping_barrage');
    const dir = target ? (Math.sign(target.position.x - x) || 1) : 1;
    rctx.save();
    rctx.strokeStyle = 'rgba(255,120,60,0.35)'; rctx.setLineDash([4, 4]);
    rctx.beginPath(); rctx.moveTo(x, y + 14); rctx.lineTo(x + dir * (s.count - 1) * s.stepX, y + 14); rctx.stroke();
    rctx.setLineDash([]);
    rctx.restore();
    for (let i = 0; i < s.count; i++) {
      const px = x + dir * i * s.stepX;
      rctx.save();
      rctx.translate(px, y);
      rctx.globalAlpha = 1 - i * 0.15;
      rctx.fillStyle = '#3a4038'; rctx.fillRect(-3, -8, 6, 12);
      rctx.fillStyle = '#1c201b';
      rctx.beginPath(); rctx.moveTo(-3, -8); rctx.lineTo(0, -13); rctx.lineTo(3, -8); rctx.closePath(); rctx.fill();
      rctx.restore();
    }
  },
};
