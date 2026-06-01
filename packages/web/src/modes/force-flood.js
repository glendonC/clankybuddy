// S-B3b — Flood (rising arena tide) force Mode.
//
// Registers on the bus with phase:'physics' so buoyancy/drag integrate in the
// 60Hz inner physics step. The flood ability (kind:'click', one-shot) calls
// startFlood() once; this Mode then maintains ONE arena water level that rises,
// holds, and drains on a sim-time FSM (advanced off the FIXED_DT passed to the
// tick — NO setTimeout, so a backgrounded tab can't desync it). It self-disables
// when the tide fully drains or when the buddy is swapped (epoch mismatch).
//
// SAFETY — the no-rocket guarantee (red-team R1). Buoyancy is the only upward
// force here and is intentionally NOT isStanding-gated (a part that floats off
// the floor must still be buoyed). Its safety is a HARD CLAMP to exactly
// COUNTER_GRAVITY_NEUTRALIZER (≈0.92× gravity-per-mass): at maximum it only
// ~neutralizes weight, so net upward acceleration is structurally impossible at
// any depth or tuning. "Higher tide" raises the LEVEL, never this ceiling.
// Velocity DRAG (a kinematic setVelocity scale, like stand.js) is a second cap.
//
// This Mode also OWNS its render (renderFlood) because a screen-wide plane has
// no natural body to hang a transient render branch on (unlike the gravity well,
// which renders via a partType branch in render/transients.js).

import Matter from 'matter-js';
import { register, setEnabled } from './bus.js';
import { engine } from '../state/world.js';
import {
  COUNTER_GRAVITY_NEUTRALIZER, COLLISION_CATEGORY,
} from '../physics/constants.js';
import { applyStatus, removeStatus, hasStatus } from '../effects/registry.js';
import { sfx } from '../audio/sfx.js';

const { Body } = Matter;

export const FORCE_FLOOD_ID = 'force.flood';

// --- Tuned constants (NaN guards / caps live here) ---

// Fraction of riseRate used while draining (recede slower than the surge).
const DRAIN_FACTOR = 0.55;
// Hard ceiling on the whirlpool horizontal force-per-mass. Lateral-only and
// pressedIntoHud-guarded, but clamped anyway so a mistuned swirlMag can't drive
// a part hard into a side wall in one step.
const MAX_SWIRL = 0.01;
// Near-zero horizontal distance to arena center: skip the swirl (no /0).
const EPS = 1e-3;
// Throttle for the reused `extinguish` douse SFX (the on-fire.js _lastSteamAt
// pattern) so dousing all six parts in one frame doesn't machine-gun it.
const DOUSE_SFX_MS = 600;

// --- One-shot tide state (all module-level; the flood is a single arena event) ---

let _active = false;
let _phase = 'rising';      // 'rising' | 'holding' | 'draining'
let _levelY = 0;            // water-surface y in canvas coords (smaller y = higher water)
let _floorY = 0;            // empty level (water starts/ends here)
let _capY = 0;              // crest (smallest y the surface reaches)
let _holdElapsed = 0;       // ms accumulated in the 'holding' phase
let _epoch = -1;            // buddy epoch at cast; tick self-cancels on mismatch
let _centerX = 0;           // arena center-x for the whirlpool variant
let _lastDouseAt = 0;

// Latched-at-cast tuning (the flood event is defined entirely by the cast; the
// Mode reads from here, never getStats, so a mid-flood purchase can't reshape an
// in-progress tide).
let _buoyancy = 0, _depthK = 0, _dragMul = 0.92, _riseRate = 4, _swirlMag = 0, _holdMs = 2400;
let _whirlpool = false, _acid = false;

// Start (or restart) the arena tide. `epoch` is ctx._epoch at the cast site so
// the tick can self-cancel after a character switch (no ragdoll-lifecycle import,
// so no module cycle). capY/floorY/centerX are resolved by the ability from the
// live canvas; the rest is latched defaultStats.
export function startFlood(cfg = {}) {
  _floorY     = cfg.floorY;
  _capY       = cfg.capY;
  _centerX    = cfg.centerX;
  _buoyancy   = cfg.buoyancy;
  _depthK     = cfg.depthK;
  _dragMul    = Number.isFinite(cfg.dragMul) ? cfg.dragMul : 0.92;
  _riseRate   = cfg.riseRate;
  _swirlMag   = cfg.swirlMag;
  _holdMs     = cfg.holdMs;
  _whirlpool  = !!cfg.whirlpool;
  _acid       = !!cfg.acid;
  _epoch      = cfg.epoch ?? -1;
  _levelY     = _floorY;       // start empty, at the floor
  _phase      = 'rising';
  _holdElapsed = 0;
  _lastDouseAt = 0;
  _active     = true;
  setEnabled(FORCE_FLOOD_ID, true);
}

// Reset + disable. Called by the tick (drain complete / epoch mismatch) and by
// spawnRagdoll (defense-in-depth on a character switch). setEnabled is queued if
// called mid-tick and applied immediately otherwise (modes/bus.js).
export function clearFlood() {
  _active = false;
  _phase = 'rising';
  _levelY = _floorY;
  _holdElapsed = 0;
  setEnabled(FORCE_FLOOD_ID, false);
}

// COPIED VERBATIM from force-magnet.js / force-gravity-well.js. Used only to gate
// the whirlpool's horizontal force (the one flood force that could shove a part
// laterally into the bottom-center hotbar HUD). Buoyancy (+y up, ≤ weight) and
// drag (velocity damp) can't drive a part into static geometry, so they're
// ungated.
function pressedIntoHud(part) {
  const pairsList = engine.pairs?.list || [];
  for (const pair of pairsList) {
    if (!pair.isActive) continue;
    const a = pair.bodyA, b = pair.bodyB;
    let other = null;
    if (a === part) other = b;
    else if (b === part) other = a;
    else continue;
    if (other.isStatic &&
        (other.collisionFilter?.category & COLLISION_CATEGORY.HUD)) {
      return true;
    }
  }
  return false;
}

function tick(ctx, dt) {
  if (!_active) return;
  // Epoch self-cancel: a character switch invalidates this tide. Using the
  // ctx-carried predicate avoids importing ragdoll-lifecycle (no module cycle).
  if (ctx?._epochValid && !ctx._epochValid(_epoch)) { clearFlood(); return; }

  // Advance the rise/hold/drain FSM off sim-time (dt = FIXED_DT in this phase).
  if (_phase === 'rising') {
    _levelY -= _riseRate;
    if (_levelY <= _capY) { _levelY = _capY; _phase = 'holding'; _holdElapsed = 0; }
  } else if (_phase === 'holding') {
    _holdElapsed += dt;
    if (_holdElapsed >= _holdMs) _phase = 'draining';
  } else { // draining
    _levelY += _riseRate * DRAIN_FACTOR;
    if (_levelY >= _floorY) { _levelY = _floorY; clearFlood(); return; }
  }

  const ragdoll = ctx?.ragdoll;
  if (!ragdoll || !ragdoll.parts) return;

  const CEIL = COUNTER_GRAVITY_NEUTRALIZER;   // per-mass; max buoyancy ≤ weight
  let dousedAny = false;

  for (const part of ragdoll.parts) {
    const depth = part.position.y - _levelY;   // >0 when submerged (canvas y grows down)
    if (depth <= 0) continue;

    // BUOYANCY (-y up), depth-scaled then HARD-CLAMPED to the gravity-grade
    // ceiling. The clamp — not the falloff — is the no-rocket firewall.
    let up = _buoyancy * (1 + depth * _depthK);
    if (up > CEIL) up = CEIL;
    if (up > 0 && Number.isFinite(up)) {
      Body.applyForce(part, part.position, { x: 0, y: -up * part.mass });
    }

    // DRAG: kinematic velocity damp (a second cap; reads as moving through water).
    Body.setVelocity(part, { x: part.velocity.x * _dragMul, y: part.velocity.y * _dragMul });

    // WHIRLPOOL (variant): clamped horizontal force toward arena center-x.
    if (_whirlpool && !pressedIntoHud(part)) {
      const dxC = _centerX - part.position.x;
      const adx = Math.abs(dxC);
      if (adx > EPS) {
        let sw = _swirlMag;
        if (sw > MAX_SWIRL) sw = MAX_SWIRL;
        if (Number.isFinite(sw) && sw > 0) {
          Body.applyForce(part, part.position, { x: (dxC / adx) * sw * part.mass, y: 0 });
        }
      }
    }

    // STATUS. Acid water stamps the EXISTING `corroded` status (overlay shrink +
    // damageMul — sets up follow-up hits; no new status, no Body.scale) and does
    // NOT douse (acid isn't water). Plain water douses on_fire ONLY — frozen is
    // left alone so the freeze→shatter line survives.
    if (_acid) {
      applyStatus(ctx.status, part, 'corroded', { duration: 1500, source: 'flood' });
    } else if (hasStatus(ctx.status, part, 'on_fire')) {
      removeStatus(ctx.status, part, 'on_fire', 'flood');
      dousedAny = true;
    }
  }

  if (dousedAny) {
    const now = performance.now();
    if (now - _lastDouseAt > DOUSE_SFX_MS) { _lastDouseAt = now; sfx.extinguish?.(); }
  }
}

// Screen-wide translucent plane from the surface down to the canvas bottom.
// Called from main.js's render block AFTER renderContactShadow and BEFORE
// renderRagdoll so the buddy reads as submerged (water behind, buddy on top).
// Early-returns when dry.
export function renderFlood(rctx, canvasW, canvasH, now) {
  if (!_active) return;
  const top = Math.max(0, _levelY);
  if (top >= canvasH) return;
  rctx.save();
  // Variant tint: acid = caustic green, water (+whirlpool) = blue.
  rctx.fillStyle = _acid ? 'rgba(120,200,80,0.30)' : 'rgba(60,130,200,0.28)';
  rctx.fillRect(0, top, canvasW, canvasH - top);
  // Brighter rippling surface line.
  rctx.strokeStyle = _acid ? 'rgba(170,230,120,0.65)' : 'rgba(150,200,235,0.65)';
  rctx.lineWidth = 2;
  rctx.beginPath();
  for (let x = 0; x <= canvasW; x += 12) {
    const yy = top + Math.sin(x * 0.04 + now * 0.004) * 2.5;
    if (x === 0) rctx.moveTo(x, yy); else rctx.lineTo(x, yy);
  }
  rctx.stroke();
  // Whirlpool tell: a couple of faint chevrons pointing inward toward center-x.
  if (_whirlpool) {
    rctx.strokeStyle = _acid ? 'rgba(170,230,120,0.4)' : 'rgba(150,200,235,0.4)';
    rctx.lineWidth = 1.5;
    const midY = (top + canvasH) / 2;
    const phase = (now * 0.06) % 60;
    for (const side of [-1, 1]) {
      for (let i = 0; i < 3; i++) {
        const x = _centerX + side * (40 + i * 70 + phase);
        rctx.beginPath();
        rctx.moveTo(x, midY - 10);
        rctx.lineTo(x - side * 12, midY);
        rctx.lineTo(x, midY + 10);
        rctx.stroke();
      }
    }
  }
  rctx.restore();
}

register({
  id: FORCE_FLOOD_ID,
  phase: 'physics',
  defaultEnabled: false,
  tick,
});
