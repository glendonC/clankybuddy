// Strafe run — a swept directional force band (phase:'physics' force Mode).
//
// The player drags a stroke = the strafe axis (origin + unit direction + length).
// A force BAND (a slab of half-width HALF_W) travels ONCE from the start of the
// axis to the end over a short sim-time window, and every ragdoll part the moving
// band is currently over gets a PARALLEL shove ALONG the axis (downrange). When
// the band clears the end, the Mode self-disables. It is a force FIELD: no body,
// passes through, works on an airborne / magnet-suspended buddy, at any drawn
// angle.
//
// THE VERB (vs the five neighbors): magnet is RADIAL toward the live cursor;
// gravity_well is a RADIAL inward sink at a fixed point; flood is VERTICAL-only,
// hard-clamped to weight-neutralization (cannot net-accelerate); steamroller /
// city_bus are SOLID floor-level horizontal bodies that squash by contact. The
// strafe is the only tool that is {parallel force} + {a TRAVELING window} +
// {arbitrary player-drawn axis} + {aerial field}. The load-bearing tell is the
// traveling band: a part is NOT shoved until the moving window reaches it, so the
// rake is sequenced along the axis (not a uniform field — that would be flood
// pointed sideways = a reskin).
//
// Structurally a single-pass clone of force-flood.js (same latch-at-cast module
// state, dt-driven advance off FIXED_DT — NO setTimeout, ctx._epochValid
// self-cancel, pressedIntoHud copied verbatim, Mode-owns-render,
// register({phase:'physics',defaultEnabled:false})). Like flood it does NOT
// import ragdoll-lifecycle (it self-cancels via ctx._epochValid) so the
// spawnRagdoll → force-strafe → ragdoll-lifecycle cycle never forms.

import Matter from 'matter-js';
import { register, setEnabled } from './bus.js';
import { engine } from '../state/world.js';
import { COUNTER_GRAVITY_NEUTRALIZER, COLLISION_CATEGORY } from '../physics/constants.js';

const { Body } = Matter;

export const FORCE_STRAFE_ID = 'force.strafe';

// --- Tuned constants (caps / guards live here, never at the call site) ---

// Band half-width along the axis (px). Kept well under a typical run length so
// the band's TRAVEL is visible — that travel is the anti-reskin property.
const HALF_W = 70;
// Max perpendicular distance from the axis line a part can be shoved.
const BAND_REACH = 160;
// HARD ceiling on |force-per-mass| downrange. Equals magnet/well MAX_PULL, which
// is regression-proven not to NaN the 0.85-stiffness joint solver in one step.
// This is the SOLVER firewall — NOT the no-rocket firewall (0.012 is ~9× the
// COUNTER_GRAVITY_NEUTRALIZER weight-grade, so it is emphatically not "small").
const MAX_SHOVE = 0.012;
// Axis-normalize zero-length guard (a degenerate cast). NOT a `|| 1` divisor.
const EPS = 1e-3;
// Band center advances this many px per physics step (the sweep). INVARIANT:
// HALF_W >= 3 * SWEEP_SPEED so consecutive band positions OVERLAP and the band
// can never STEP OVER a part between frames and silently miss it. Any future
// SWEEP_SPEED bump (or a HALF_W stat) MUST preserve HALF_W >= 3 * SWEEP_SPEED.
const SWEEP_SPEED = 9;

// --- One-shot sweep state (latched at cast; the Mode reads here, NEVER getStats
// mid-sweep, so a mid-sweep purchase can't reshape an in-flight pass) ---
let _active = false;
let _ox = 0, _oy = 0;      // axis origin (the press point)
let _ux = 1, _uy = 0;      // axis unit direction (downrange)
let _s = 0;                // current band-center position along the axis (px from origin)
let _s1 = 0;               // band fully clears the run end at this position
let _shove = MAX_SHOVE;    // latched force-per-mass (clamped to MAX_SHOVE)
let _moodDelta = 0;        // one-shot mood hit applied when the band first sweeps a part
let _epoch = -1;           // buddy epoch at cast; tick self-cancels on mismatch
let _moodFired = false;    // latch: the mood hit fires ONCE per pass (no per-step machine-gun)

// Start (or restart) a strafe pass. cfg.ox/oy = origin, cfg.ux/uy = unit axis,
// cfg.len = stroke length, cfg.shove = force-per-mass, cfg.moodDelta, cfg.epoch
// (ctx._epoch at the cast site, for the tick's self-cancel — no ragdoll-lifecycle
// import, so no module cycle).
export function startStrafe(cfg = {}) {
  _ox = cfg.ox; _oy = cfg.oy;
  _ux = cfg.ux; _uy = cfg.uy;
  const L = Number.isFinite(cfg.len) ? cfg.len : 0;
  // Clamp at INTAKE too, so a mistuned stat can't smuggle a bigger value past.
  _shove = Number.isFinite(cfg.shove) ? Math.min(cfg.shove, MAX_SHOVE) : MAX_SHOVE;
  _moodDelta = Number.isFinite(cfg.moodDelta) ? cfg.moodDelta : 0;
  _s = -HALF_W;        // leading edge enters exactly at the origin
  _s1 = L + HALF_W;    // band fully clears the run end
  _epoch = cfg.epoch ?? -1;
  _moodFired = false;
  _active = true;
  setEnabled(FORCE_STRAFE_ID, true);
}

// Reset + disable. Called by the tick (sweep complete / epoch mismatch / degenerate
// axis) and by spawnRagdoll (defense-in-depth on a character switch). setEnabled is
// queued if called mid-tick and applied after the pass (modes/bus.js).
export function clearStrafe() {
  _active = false;
  _s = 0;
  setEnabled(FORCE_STRAFE_ID, false);
}

// COPIED VERBATIM from force-flood.js / force-magnet.js (standing rule: each force
// loop keeps its own copy, never shared). The parallel shove is DIRECTIONAL and
// could drive a part into the bottom-center HUD geometry, so it must be gated
// (unlike flood's ungated buoyancy/drag, which can't push laterally into HUD).
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
  // Epoch self-cancel: a character switch invalidates this pass. Uses the
  // ctx-carried predicate (no ragdoll-lifecycle import → no module cycle).
  if (ctx?._epochValid && !ctx._epochValid(_epoch)) { clearStrafe(); return; }

  // Advance the TRAVELING band off sim-time (dt = FIXED_DT in this phase). When
  // the band has fully cleared the run end, the pass is done.
  _s += SWEEP_SPEED;
  if (_s > _s1) { clearStrafe(); return; }

  const ragdoll = ctx?.ragdoll;
  if (!ragdoll || !ragdoll.parts) return;
  // Degenerate (zero-length) axis paranoia: never normalize / shove on a bad axis.
  if (Math.hypot(_ux, _uy) < EPS) { clearStrafe(); return; }

  // ROCKET FIREWALL ceiling: the shove's UPWARD (-y) component is independently
  // clamped to weight-neutralization so a straight-up run can at most ~hold the
  // buddy aloft per step (real gravity-per-step 0.0014 > this 0.001288, so a
  // clamped vertical pass stays weight-dominated and cannot net-accelerate up).
  // Combined with the single-pass window (a part is under the band only
  // ~2*HALF_W/SWEEP_SPEED steps) there is no sustained lift to integrate into an
  // escape — and there is NO separate counter-gravity lift term (unlike magnet),
  // so nothing stacks.
  const CEIL = COUNTER_GRAVITY_NEUTRALIZER;

  for (const part of ragdoll.parts) {
    const rx = part.position.x - _ox, ry = part.position.y - _oy;
    const t = rx * _ux + ry * _uy;                 // signed along-axis projection
    if (Math.abs(t - _s) > HALF_W) continue;       // BAND gate (longitudinal) — the SWEEP
    const perpx = rx - t * _ux, perpy = ry - t * _uy;
    if (Math.hypot(perpx, perpy) > BAND_REACH) continue;   // BAND gate (lateral)
    if (pressedIntoHud(part)) continue;            // never shove a part already in HUD contact

    let mag = _shove;
    if (mag > MAX_SHOVE) mag = MAX_SHOVE;          // SOLVER firewall (hard clamp)
    if (!Number.isFinite(mag) || mag <= 0) continue;

    const F = mag * part.mass;
    let fx = _ux * F, fy = _uy * F;                // PARALLEL shove along the latched axis
    const upCap = -CEIL * part.mass;
    if (fy < upCap) fy = upCap;                    // ROCKET firewall: clamp the -y component
    if (!Number.isFinite(fx) || !Number.isFinite(fy)) continue;   // belt-and-suspenders
    Body.applyForce(part, part.position, { x: fx, y: fy });

    // One-shot mood: the FIRST part the band sweeps takes the morale hit (latched
    // so the per-step band overlap can't re-fire reactTo + its combo append every
    // step). First-swept (not head-specific) so a leg-only rake still lands its
    // mood once.
    if (!_moodFired && _moodDelta) {
      _moodFired = true;
      ctx.reactTo?.({ source: 'strafe_run', part, moodDelta: -_moodDelta });
    }
  }
}

// Mode-owns-render (a swept slab has no transient body to hang a render branch
// on, same rationale as renderFlood). A translucent gun-metal slab perpendicular
// to the axis at the band center, a faint full-axis guide, and a couple of motion
// streaks parallel to the axis. Called from main.js AFTER renderRagdoll (a gun-run
// passes IN FRONT of the buddy, unlike flood's water which sits behind). Early-out
// when idle.
export function renderStrafe(rctx, now) {
  if (!_active) return;
  const px = -_uy, py = _ux;            // perpendicular basis
  const cx = _ox + _ux * _s, cy = _oy + _uy * _s;   // band center
  const reach = BAND_REACH;
  rctx.save();
  // Faint full-axis guide (origin → end), so the run's line reads.
  rctx.strokeStyle = 'rgba(200,210,225,0.18)';
  rctx.lineWidth = 1.5;
  rctx.beginPath();
  rctx.moveTo(_ox, _oy);
  rctx.lineTo(_ox + _ux * (_s1 - HALF_W), _oy + _uy * (_s1 - HALF_W));
  rctx.stroke();
  // The swept slab (band) — a quad spanning ±HALF_W along the axis and ±reach
  // perpendicular, centered on the band position.
  const ax = cx - _ux * HALF_W, ay = cy - _uy * HALF_W;
  const bx = cx + _ux * HALF_W, by = cy + _uy * HALF_W;
  rctx.fillStyle = 'rgba(150,170,200,0.18)';
  rctx.beginPath();
  rctx.moveTo(ax + px * reach, ay + py * reach);
  rctx.lineTo(bx + px * reach, by + py * reach);
  rctx.lineTo(bx - px * reach, by - py * reach);
  rctx.lineTo(ax - px * reach, ay - py * reach);
  rctx.closePath();
  rctx.fill();
  // Brighter leading edge (the wavefront).
  rctx.strokeStyle = 'rgba(220,230,245,0.5)';
  rctx.lineWidth = 2;
  rctx.beginPath();
  rctx.moveTo(bx + px * reach, by + py * reach);
  rctx.lineTo(bx - px * reach, by - py * reach);
  rctx.stroke();
  // A couple of tracer streaks parallel to the axis (cosmetic strafing fire).
  rctx.strokeStyle = 'rgba(255,235,180,0.4)';
  rctx.lineWidth = 1.5;
  for (const off of [-reach * 0.4, reach * 0.4]) {
    const sx = cx + px * off - _ux * HALF_W, sy = cy + py * off - _uy * HALF_W;
    rctx.beginPath();
    rctx.moveTo(sx, sy);
    rctx.lineTo(sx + _ux * HALF_W * 1.6, sy + _uy * HALF_W * 1.6);
    rctx.stroke();
  }
  rctx.restore();
}

register({
  id: FORCE_STRAFE_ID,
  phase: 'physics',
  defaultEnabled: false,
  tick,
});
