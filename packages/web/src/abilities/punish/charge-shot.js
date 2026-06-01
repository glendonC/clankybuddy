import Matter from 'matter-js';
import * as P from '../../particles.js';
import { sfx } from '../../audio/sfx.js';
import { drawAimLine, drawCrosshair } from '../../render/shared-cursor.js';
import { getStats } from '../_stats.js';
import { aimAngle } from '../_shared.js';

const { Body, Bodies, Composite } = Matter;

// Hold-breath charge shot — a charge fork on the sniper rifle (kind:'drag').
// Press and HOLD to steady your breath; the longer you hold, the more the slug
// pierces. A snap release drills ONE limb (pierce 1); a full charge punches a
// heavy round clean through the whole line (pierce 4). The CHARGE modulates the
// PIERCE BUDGET — the same axis the spec uses to separate handgun(1)/sniper(2)/
// railgun(6) — so it's a player-controlled verb, not a damage scalar. Reuses the
// pierce_bullet dispatcher natively, byte-for-byte the sniper-rifle.js spawn
// (NO markPierce → no _apConverted → renders as the cyan penetrator streak).
export const defaultStats = {
  chargeMs:  900,   // hold time (ms) to full charge (c=1). READ in applyRelease (ratio denom) + drawCursor (meter/pip). Cut by Bipod.
  pierceMin: 1,     // pierce budget at c=0 (snap): single-target drill, stops at part #1.
  pierceMax: 4,     // pierce budget at c=1 (full charge): whole-body line. Raised by Heavy barrel.
  dmgMin:    18,    // damage at c=0 (below sniper's 28 — a snap is a weaker single poke; sidegrade, not a strict upgrade).
  dmgMax:    46,    // damage at c=1 (above sniper's 28 — a committed shot is heavier). Raised by Heavy barrel.
  speedMin:  26,    // muzzle velocity at c=0 (flat-trajectory safe; sniper fires 32).
  speedMax:  40,    // muzzle velocity at c=1.
  stunMs:    650,   // flat per-part stun (charge differentiates via pierce/dmg).
  lifeMs:    1400,  // slug lifetime fallback removal (matches sniper).
  shakeMin:  5,     // screen shake at c=0.
  shakeMax:  12,    // screen shake at c=1.
  pierceShatter: false, // handler reads !!self._pierceShatter; not wired this batch (sniper owns anti-materiel).
};

// Charge ratio in [0,1] from hold time. /0-guarded by (chargeMs || 900).
function chargeRatio(s, holdMs) {
  return Math.max(0, Math.min(1, holdMs / (s.chargeMs || 900)));
}

// Charge ratio → INTEGER pierce budget (the load-bearing verb read the dispatcher
// decrements). ROUND, not floor, so every advertised tier sits in a reachable band
// (pierceMin 1 / pierceMax 4 → x1 c<1/6, x2, x3, x4 c>5/6). Math.max(1,...) guards
// the snap (c=0 → pierceMin). MUST stay byte-identical to drawCursor's pip count.
function pierceFor(s, c) {
  return Math.max(1, Math.min(s.pierceMax, s.pierceMin + Math.round((s.pierceMax - s.pierceMin) * c)));
}

export default {
  id: 'charge_shot',
  defaultStats,
  // kind:'drag' → fires on mouseup via applyRelease (mousedown returns early in
  // mouse.js, so there is no apply()). holdMs is the drag-release ctx seam.
  applyRelease(ctx) {
    const s = getStats('charge_shot');
    const { ragdoll, world, x, y, screenShake, holdMs = 0 } = ctx;   // x,y = the PRESS point; holdMs defaults 0 (defensive)
    const { angle, ok } = aimAngle(ragdoll, x, y);                   // 3-arg; family defaults 'firearms'
    if (!ok) return;                                                 // no buddy → no-op (matches sniper/gun guard)

    const c = chargeRatio(s, holdMs);
    const lerp = (a, b) => a + (b - a) * c;
    const pierce = pierceFor(s, c);                                  // THE VERB: charge → drill count
    const damage = lerp(s.dmgMin, s.dmgMax);
    const speed  = lerp(s.speedMin, s.speedMax);
    const shake  = lerp(s.shakeMin, s.shakeMax);

    const muzzleX = x + Math.cos(angle) * 26;
    const muzzleY = y + Math.sin(angle) * 26;
    const vx = Math.cos(angle) * speed, vy = Math.sin(angle) * speed;

    const slug = Bodies.circle(muzzleX, muzzleY, 4, {
      frictionAir: 0, friction: 0, density: 0.006, restitution: 0.05,
      label: 'pierce_bullet', render: { visible: false },
    });
    slug.partType    = 'pierce_bullet';
    slug._verb       = ctx._verb || 'charge_shot';
    slug.bornAt      = performance.now();
    slug.lifeMs      = s.lifeMs;
    slug.bulletDamage = damage;
    slug.bulletStun  = s.stunMs;
    slug._pierceLeft = pierce;
    slug._hitSet     = new Set();
    slug._pierceShatter = !!s.pierceShatter;
    Body.setVelocity(slug, { x: vx, y: vy });   // before push so dryBulletHit reads the hit direction
    Composite.add(world, slug);
    ctx.transientBodies.push(slug);

    sfx.sniper();
    screenShake(shake, 120);
    P.burst(muzzleX, muzzleY, Math.round(lerp(6, 14)), { type: 'fire',  color: '#ffe7a0', size: 5, life: 180, speedRange: 0.6 });
    P.burst(muzzleX, muzzleY, 4,                        { type: 'smoke', color: '#888',    size: 6, life: 380, speedRange: 0.3, gravity: -0.0002 });
  },
  drawCursor(ctx, { x, y, target, angle, isDown, dragStart }) {
    const s = getStats('charge_shot');
    // Aim preview tracks the LIVE cursor (lock-line when aimbot owns a target,
    // else a plain crosshair) — same idiom as sniper.
    if (target) drawAimLine(ctx, x, y, target); else drawCrosshair(ctx, x, y);
    // Rifle silhouette (reuse sniper's exact look so it reads as a precision firearm).
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle);
    ctx.fillStyle = '#1c1c20'; ctx.fillRect(-6, -2, 10, 13);   // stock
    ctx.fillStyle = '#2a2a31'; ctx.fillRect(-6, -3, 36, 5);    // long barrel
    ctx.fillStyle = '#15151a'; ctx.fillRect(30, -2, 4, 2);     // muzzle
    ctx.fillStyle = '#4a4a52'; ctx.fillRect(4, -8, 9, 3);      // scope tube
    ctx.restore();

    // Charge meter — only while held. Drawn at the PRESS origin (the true fire
    // origin via aimAngle(ragdoll, dragStart.x/y)), so it holds steady even if
    // the aim cursor drifts during the hold.
    if (!isDown || !dragStart) return;
    const c = chargeRatio(s, performance.now() - dragStart.t);
    const cx = dragStart.x, cy = dragStart.y, R = 22;
    const full = c >= 0.999;
    ctx.save();
    ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgba(255,255,255,0.22)';
    ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.stroke();
    ctx.strokeStyle = full ? '#9be7ff' : `rgba(255,231,160,${0.6 + c * 0.4})`;
    if (full) { ctx.shadowColor = '#9be7ff'; ctx.shadowBlur = 10; }
    ctx.beginPath(); ctx.arc(cx, cy, R, -Math.PI / 2, -Math.PI / 2 + c * Math.PI * 2); ctx.stroke();
    ctx.shadowBlur = 0;
    // Live pierce-pip count — surfaces the VERB (line depth), not a vague power
    // bar. Uses the SAME formula as applyRelease so the meter never lies.
    const pierce = pierceFor(s, c);
    ctx.fillStyle = full ? '#9be7ff' : '#ffe7a0';
    ctx.font = 'bold 11px monospace'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(`x${pierce}`, cx, cy);
    ctx.restore();
  },
};
