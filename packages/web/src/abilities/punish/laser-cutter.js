// packages/web/src/abilities/punish/laser-cutter.js
// Laser cutter — directed cutting line. kind:'hold' (FIRE_INTERVAL ~30ms).
// A continuous cutting beam from the cursor along the aim: gatherInSegment
// finds every part the beam crosses, applyImpulseScaled shoves them along
// the beam, a throttled on_fire roll burns/cuts, and any frozen (brittle)
// part the beam crosses SHATTERS. The beam is RENDER-ONLY (drawn in
// drawCursor) — no physics body, no transientBodies push, no setTimeout,
// so no epoch guard is needed.
import { beep } from '../../audio/core.js';
import { applyStatus, isBrittle } from '../../effects/registry.js';
import { getStats } from '../_stats.js';
import { nearestPart, gatherInSegment, applyImpulseScaled, shatter } from '../_shared.js';

export const defaultStats = {
  range:        320,   // beam length in px
  beamRadius:   14,    // perpendicular cut width (segment radius)
  pushForce:    0.012, // force-per-mass shove along the beam
  igniteChance: 0.5,   // per-tick on_fire roll (the throttle/ramp)
  moodPerTick:  0.7,   // subtracted per touched part (positive number)
};

export default {
  id: 'laser_cutter',
  defaultStats,
  apply(ctx) {
    const s = getStats('laser_cutter');
    const { ragdoll, status, x, y, dx, dy } = ctx;
    const nearest = nearestPart(ragdoll, x, y);
    if (!nearest) return;

    // Aim: cursor sweep direction if the cursor is moving, else cursor->buddy.
    const angle = (Math.hypot(dx || 0, dy || 0) > 1.5)
      ? Math.atan2(dy, dx)
      : Math.atan2(nearest.position.y - y, nearest.position.x - x);

    const ax = x, ay = y;
    const bx = x + Math.cos(angle) * s.range;
    const by = y + Math.sin(angle) * s.range;

    const hits = gatherInSegment(ragdoll, ax, ay, bx, by, s.beamRadius);

    if (!hits.length) {
      // Beam slicing empty air still reads as menacing — small ambient dread.
      ctx.reactTo?.({ moodDelta: -s.moodPerTick * 0.3, speakMs: 99999 });
    }

    const nx = Math.cos(angle), ny = Math.sin(angle);
    for (const part of hits) {
      // Frozen parts the beam crosses shatter outright (shatter clears frozen,
      // -25 mood, ice burst, shatter hit-stop tier, SHATTER! combo).
      if (isBrittle(status, part)) shatter(ctx, part);

      const { fx, fy } = applyImpulseScaled(part, nx, ny, s.pushForce);

      // Throttled cut/burn: the per-tick random roll IS the ramp, not a timer.
      if (Math.random() < s.igniteChance) {
        applyStatus(status, part, 'on_fire', { source: 'laser_cutter' });
      }

      ctx.reactTo?.({
        source: 'laser_cutter',
        part,
        moodDelta: -s.moodPerTick,
        impulse: Math.hypot(fx, fy),
        // huge speakMs so a held beam doesn't spam speech; let the head talk
        // a little so direct head-cuts still draw a line.
        speakMs: part === ragdoll.head ? 600 : 99999,
      });
    }

    if (hits.length) {
      ctx.screenShake?.(2, 80);
      // Steady high beam hum, throttled by a per-tick roll so overlapping
      // ticks blend into a continuous tone (magnet-hum pattern). beep is the
      // real audio/core.js primitive — there is no sfx.beam voice.
      if (Math.random() < 0.5) {
        beep({ freq: 1400, dur: 0.05, type: 'sawtooth', vol: 0.05, sweep: 60 });
      }
    }
  },

  // Beam is render-only: painted here every frame, never a colliding body.
  // ctx is a raw CanvasRenderingContext2D; { x, y } = cursor, target =
  // nearestPart, angle = atan2(target - cursor), isDown = mouse held.
  drawCursor(ctx, { x, y, target, angle, isDown }) {
    const s = getStats('laser_cutter');
    const a = angle || 0;

    // Emitter head at the cursor, oriented along the aim.
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(a);
    ctx.fillStyle = '#2a2a31'; ctx.fillRect(-12, -6, 22, 12); // body
    ctx.fillStyle = '#3a4650'; ctx.fillRect(-12, -6, 6, 12);  // grip cap
    ctx.fillStyle = '#cfd8e3'; ctx.fillRect(8, -3, 6, 6);     // lens housing
    ctx.fillStyle = isDown ? '#ff5a4a' : '#5a2420'; ctx.fillRect(13, -2, 3, 4); // emitter tip
    ctx.restore();

    if (!isDown) return;

    const ex = x + Math.cos(a) * s.range;
    const ey = y + Math.sin(a) * s.range;

    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineCap = 'round';

    // Soft outer glow.
    ctx.strokeStyle = 'rgba(255, 60, 50, 0.30)';
    ctx.lineWidth = 9;
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(ex, ey); ctx.stroke();

    // Mid bloom (flickers slightly so the beam reads as live).
    ctx.strokeStyle = 'rgba(255, 110, 90, 0.55)';
    ctx.lineWidth = 4 + Math.random() * 1.5;
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(ex, ey); ctx.stroke();

    // Bright white-hot core.
    ctx.strokeStyle = 'rgba(255, 235, 225, 0.95)';
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(ex, ey); ctx.stroke();

    // Hot sparking impact dot where the beam crosses the aimed part.
    if (target) {
      const r = 3 + Math.random() * 2.5;
      ctx.fillStyle = '#fff';
      ctx.beginPath(); ctx.arc(target.position.x, target.position.y, r, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = 'rgba(255, 150, 90, 0.7)';
      ctx.beginPath(); ctx.arc(target.position.x, target.position.y, r * 2.2, 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();
  },
};
