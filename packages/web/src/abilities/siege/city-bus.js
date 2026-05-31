// City bus, siege vehicle (child of steamroller). Same onTick roller skeleton
// as the steamroller (reuses spawnRoller), but its verb is a SCOOP: on contact
// the bus's transient handler shoves the struck part with a strong sustained
// horizontal velocity toward the off-screen direction, carrying the persistent
// buddy out of view. The buddy is NEVER despawned — once the bus is gone the
// ragdoll drifts/falls back on its own. Self-removes off the far edge.
//
// File-id note: the tool id is `city_bus` (underscore); the file is hyphenated
// (city-bus.js) to match the repo convention (bowling-ball.js → bowling_ball).
// The index.js / _stats.js maps bridge the two: `city_bus: cityBus`.

import { getStats } from '../_stats.js';
import { spawnRoller } from './steamroller.js';
import { sfx } from '../../audio/sfx.js';

export const defaultStats = {
  mood:  20,
  speed: 8,    // px/frame; a touch faster than the steamroller so the scoop reads
};

export default {
  id: 'city_bus',
  defaultStats,
  apply(ctx) {
    const s = getStats('city_bus');
    spawnRoller(ctx, {
      partType: 'city_bus',
      w: 220, h: 86,
      density: 0.04, friction: 0.5,
      lifeMs: 9000,
      spin: 0,            // a bus body doesn't tumble; wheels are cosmetic
      speed: s.speed,
      // Per-contact handler reads these off the body. _scoop marks this roller
      // as the carry-off-stage verb (vs. steamroller's flatten).
      fields: { _mood: s.mood, _scoop: true },
    });
    // Engine note + air horn on spawn.
    if (sfx.cityBus) sfx.cityBus();
  },
  drawCursor(ctx, { x, y }) {
    ctx.save();
    ctx.translate(x, y);
    // Long bus body.
    ctx.fillStyle = '#e0a92b';
    ctx.fillRect(-22, -10, 44, 16);
    // Windows.
    ctx.fillStyle = '#9fd3e8';
    for (let wx = -19; wx < 16; wx += 8) ctx.fillRect(wx, -7, 6, 6);
    // Front scoop bumper (leading edge).
    ctx.fillStyle = '#3a3a40';
    ctx.fillRect(-24, 2, 6, 6);
    // Wheels.
    ctx.fillStyle = '#1f1f24';
    ctx.beginPath(); ctx.arc(-13, 8, 5, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(14, 8, 5, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
    ctx.save();
    ctx.strokeStyle = 'rgba(255,255,255,0.20)';
    ctx.setLineDash([5, 5]);
    ctx.beginPath();
    ctx.moveTo(x - 44, y + 18); ctx.lineTo(x + 44, y + 18);
    ctx.stroke();
    ctx.restore();
  },
};
