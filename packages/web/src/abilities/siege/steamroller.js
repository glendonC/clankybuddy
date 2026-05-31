// Steamroller, siege-vehicle root. A heavy drum rolls in from one screen edge
// and crosses the stage, flattening every part it runs over. onTick maintains
// the horizontal x-velocity KINEMATICALLY (re-stamped each render frame so
// friction can't drag it to a halt), epoch-gated; the body self-removes once it
// has rolled fully off the far edge. The per-substep squash + 'concussed' apply
// lives in the registered transient handler (transients/steamroller.js).
//
// Shares its onTick roller skeleton with city_bus via the local spawnRoller()
// helper exported below (both vehicles are authored together).

import Matter from 'matter-js';
import { getStats } from '../_stats.js';
import { canvas } from '../../state/world.js';
import { sfx } from '../../audio/sfx.js';

const { Body, Bodies, Composite } = Matter;

const OFF_PAD = 140;   // how far past the edge before the vehicle despawns

// Shared roller factory for the two siege vehicles. Spawns a heavy body at one
// screen edge, attaches the KINEMATIC-ONLY onTick (re-stamp x-velocity + spin,
// off-screen self-removal, epoch-gated), pushes it to ctx.transientBodies, and
// returns the body so the caller can stash extra per-body fields. The vehicle's
// per-contact behavior is owned by its registered transient handler, NOT here.
//
// cfg: { partType, w, h, density, friction, lifeMs, spin } and any extra
// per-body fields are merged onto the body via `fields`.
export function spawnRoller(ctx, cfg) {
  const {
    partType,
    w = 120, h = 70,
    density = 0.05, friction = 0.6,
    lifeMs = 9000,
    spin = 0.02,
    speed = 7,
    fields = {},
  } = cfg;
  const { world, x } = ctx;
  // Enter from whichever side is FARTHER from the cursor so it rolls across the
  // buddy rather than spawning on top of it.
  const fromLeft = x > canvas.width / 2;
  const startX   = fromLeft ? -OFF_PAD + 20 : canvas.width + OFF_PAD - 20;
  const vx       = fromLeft ? Math.abs(speed) : -Math.abs(speed);
  // Sit on the floor band so it crosses at body height, not midair.
  const groundY  = canvas.height - h / 2 - 8;

  const body = Bodies.rectangle(startX, groundY, w, h, {
    density, friction, frictionAir: 0,
    label: partType, render: { visible: false },
  });
  body.partType = partType;
  body._verb    = ctx._verb || partType;
  body.bornAt   = performance.now();
  body.lifeMs   = lifeMs;       // hard cap; onTick removes earlier when off-screen
  body._epoch   = ctx._epoch;   // CAPTURE epoch so the onTick gate is meaningful
  body._vx      = vx;
  Object.assign(body, fields);

  // KINEMATIC-ONLY onTick (render frame): re-stamp horizontal velocity so
  // friction/contacts can't stall the roll, add a visual drum spin, and
  // self-remove once fully off the far edge. NO force / NO sweepImpact here.
  body.onTick = (self, ctx2) => {
    Body.setVelocity(self, { x: self._vx, y: self.velocity.y });
    if (spin) Body.setAngularVelocity(self, self._vx * spin);
    const off = self._vx > 0
      ? self.position.x > canvas.width + OFF_PAD
      : self.position.x < -OFF_PAD;
    if (off) {
      self._spent = true;                 // mark BEFORE the splice
      Composite.remove(ctx2.world, self);
      const i = ctx2.transientBodies.indexOf(self);
      if (i >= 0) ctx2.transientBodies.splice(i, 1);
    }
  };

  Body.setVelocity(body, { x: vx, y: 0 });
  Composite.add(world, body);
  ctx.transientBodies.push(body);
  return body;
}

export const defaultStats = {
  mood:  24,
  speed: 7,    // px/frame x-velocity maintained kinematically
};

export default {
  id: 'steamroller',
  defaultStats,
  apply(ctx) {
    const s = getStats('steamroller');
    spawnRoller(ctx, {
      partType: 'steamroller',
      w: 130, h: 74,
      density: 0.06, friction: 0.6,
      lifeMs: 9000,
      spin: 0.05,
      speed: s.speed,
      // Per-contact handler reads these off the body.
      fields: { _mood: s.mood },
    });
    // Heavy diesel rumble on spawn.
    if (sfx.steamrollerRumble) sfx.steamrollerRumble();
  },
  drawCursor(ctx, { x, y }) {
    ctx.save();
    ctx.translate(x, y);
    // Cab + frame.
    ctx.fillStyle = '#3b3b40';
    ctx.fillRect(-2, -16, 16, 12);
    ctx.fillStyle = '#52525a';
    ctx.fillRect(-18, -6, 36, 8);
    // Heavy front drum.
    ctx.fillStyle = '#1f1f24';
    ctx.beginPath(); ctx.arc(-12, 6, 11, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.16)';
    ctx.beginPath(); ctx.arc(-15, 3, 3, 0, Math.PI * 2); ctx.fill();
    // Rear wheel.
    ctx.fillStyle = '#26262b';
    ctx.beginPath(); ctx.arc(13, 8, 6, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
    ctx.save();
    ctx.strokeStyle = 'rgba(255,255,255,0.20)';
    ctx.setLineDash([5, 5]);
    ctx.beginPath();
    ctx.moveTo(x - 40, y + 22); ctx.lineTo(x + 40, y + 22);
    ctx.stroke();
    ctx.restore();
  },
};
