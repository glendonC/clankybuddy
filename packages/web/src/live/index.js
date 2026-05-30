// Live behavior driver, opt-in via the `liveMode` setting (off by default
// per docs/ideas.md). When enabled, the buddy gets agency:
// - gentle horizontal walking (idle drift)
// - cursor-proximity dodge (side-step when an armed punish-cursor enters
//   threat radius)
// - projectile dodge (small impulse if a transient is heading towards the
//   chest within ~300ms ETA)
// - panic meter that ramps with sustained negative attention. At 1.0 the
//   character's signature panic move fires (see live/panic-moves.js).
//
// Default OFF because the always-on idle walk made the buddy slide around
// the stage without user input, fine for a "buddy with agency" demo, wrong
// for the stress-relief premise. Gate lives at main.js:liveTick call site.
//
// Anti-design (ideas.md): the buddy must NEVER feel unhittable. Dodge
// success caps at 40% for fast attacks, 70% for slow telegraphed ones.
// Frustration is the enemy here, not difficulty.

import Matter from 'matter-js';
import { getActiveTool } from '../ui/hotbar.js';
import { TOOLS_BY_ID } from '../ui/tools-table.js';
import { getMouseState } from '../input/mouse.js';
import { popBubble } from '../ui/speech-bubbles.js';
import { firePanicMove } from './panic-moves.js';
import { ragdollCenter } from '../physics/ragdoll.js';
import { hasStatus } from '../effects/registry.js';
import { getPersona } from '../personas/index.js';

const { Body } = Matter;

// Tunables, dodge probabilities stay conservative (ideas.md anti-design
// clause: the buddy must never feel unhittable). Locomotion forces are
// large enough that the buddy actually translates across the stage,
// previous values were sub-perceptible against stand.js's chest x damping.
const PANIC_RAMP_PER_HIT      = 0.18;   // each landed hit
const PANIC_DECAY_PER_SEC     = 0.12;   // bleeds off when ignored
const PANIC_TRIGGER           = 1.0;
const PANIC_COOLDOWN_MS       = 8000;
const DODGE_PROBABILITY_FAST  = 0.4;
const DODGE_PROBABILITY_SLOW  = 0.7;
const PROJECTILE_LOOKAHEAD_MS = 320;
const CURSOR_THREAT_RADIUS    = 130;
const DODGE_IMPULSE_X         = 0.045;  // chest impulse magnitude
const DODGE_COOLDOWN_MS       = 350;    // can't spam dodges every frame

// Locomotion: mass-scaled so the chest velocity damping in stand.js (0.985
// per step ≈ 58%/sec) doesn't swallow it. Applied to chest AND both legs
// so the body actually marches instead of dragging the chest while legs
// hang behind.
const WALK_CHEST_FORCE = 0.0014;
const WALK_LEG_FORCE   = 0.0010;

// Idle state machine. The buddy alternates between WANDER (translating
// across the stage) and PAUSE (standing still, looking around). Periodic
// FIDGET interrupts at high recent-positive affect, small upward hop.
const STATE_WANDER = 'wander';
const STATE_PAUSE  = 'pause';
const WANDER_DURATION_MIN = 1800;
const WANDER_DURATION_MAX = 3600;
const PAUSE_DURATION_MIN  = 900;
const PAUSE_DURATION_MAX  = 2400;
const EDGE_BUFFER_PX      = 120; // turn around inside this distance from a wall

const _state = {
  panic: 0,
  walkDir: 1,
  // Idle locomotion FSM
  loco: STATE_PAUSE,
  locoUntil: 0,
  lastDodgeAt: 0,
  panicCooldownUntil: 0,
  lastTickT: 0,
  lastHitsSeen: 0,
};

export function getLiveState() { return _state; }

// Reset on character switch, main.js calls this from onCharChange.
export function resetLive() {
  _state.panic = 0;
  _state.walkDir = Math.random() < 0.5 ? -1 : 1;
  _state.loco = STATE_PAUSE;
  _state.locoUntil = 0;
  _state.lastDodgeAt = 0;
  _state.panicCooldownUntil = 0;
  _state.lastHitsSeen = 0;
}

export function liveTick(ctx, dtMs) {
  const { ragdoll, mood, status, transientBodies, world } = ctx;
  if (!ragdoll) return;

  const now = performance.now();
  // Don't try to act while ragdoll is being held by MouseConstraint
  if (ragdoll.dragging) return;
  if (ragdoll.stunUntil && now < ragdoll.stunUntil) return;
  if (ragdoll.limpUntil && now < ragdoll.limpUntil) return;

  // ---------- panic meter ----------
  if (mood.hits > _state.lastHitsSeen) {
    const delta = mood.hits - _state.lastHitsSeen;
    _state.panic = Math.min(1.5, _state.panic + delta * PANIC_RAMP_PER_HIT);
  }
  _state.lastHitsSeen = mood.hits;
  _state.panic = Math.max(0, _state.panic - (PANIC_DECAY_PER_SEC * dtMs) / 1000);

  if (_state.panic >= PANIC_TRIGGER && now > _state.panicCooldownUntil) {
    _state.panicCooldownUntil = now + PANIC_COOLDOWN_MS;
    _state.panic = 0;
    firePanicMove(ctx);
    return;
  }

  // ---------- dodging ----------
  if (now - _state.lastDodgeAt > DODGE_COOLDOWN_MS) {
    if (tryProjectileDodge(ragdoll, transientBodies, now)) {
      _state.lastDodgeAt = now;
      return;
    }
    if (tryCursorDodge(ragdoll, now)) {
      _state.lastDodgeAt = now;
      return;
    }
  }

  // ---------- idle locomotion FSM ----------
  // Suppress idle walk while behavior scheduler has the buddy fleeing, its
  // flee force already drives locomotion toward a corner. Also bail when
  // the buddy is on fire / electrified, those statuses have their own
  // panic-run / convulse locomotion in effects/_locomotion.js.
  if (ragdoll._fleeing) return;
  for (const p of ragdoll.parts) {
    if (status && (hasStatus(status, p, 'on_fire') || hasStatus(status, p, 'electrified'))) return;
  }

  // State transitions, first tick or timer expired.
  if (!_state.locoUntil || now >= _state.locoUntil) {
    if (_state.loco === STATE_WANDER) {
      _state.loco = STATE_PAUSE;
      _state.locoUntil = now + PAUSE_DURATION_MIN
        + Math.random() * (PAUSE_DURATION_MAX - PAUSE_DURATION_MIN);
    } else {
      _state.loco = STATE_WANDER;
      _state.walkDir = Math.random() < 0.5 ? -1 : 1;
      _state.locoUntil = now + WANDER_DURATION_MIN
        + Math.random() * (WANDER_DURATION_MAX - WANDER_DURATION_MIN);
    }
  }

  if (_state.loco !== STATE_WANDER) return;

  // Stay inside the playfield, flip direction near walls.
  const center = ragdollCenter(ragdoll);
  const stageW = world.bounds?.max?.x ?? 1200;
  if (center.x < EDGE_BUFFER_PX && _state.walkDir < 0) _state.walkDir = 1;
  if (center.x > stageW - EDGE_BUFFER_PX && _state.walkDir > 0) _state.walkDir = -1;

  // Mass-scaled forces on chest and legs, both push so the body actually
  // marches across the stage instead of the chest dragging hesitant legs.
  const dir = _state.walkDir;
  const chest = ragdoll.chest;
  Body.applyForce(chest, chest.position, {
    x: dir * WALK_CHEST_FORCE * chest.mass,
    y: 0,
  });
  for (const leg of [ragdoll.bodyMap?.legL, ragdoll.bodyMap?.legR]) {
    if (!leg) continue;
    Body.applyForce(leg, leg.position, {
      x: dir * WALK_LEG_FORCE * leg.mass,
      y: 0,
    });
  }
}


// True if we dodged. Scans transient bodies (bullets, rockets, fireballs,
// grenades) for a hit-zone overlap inside LOOKAHEAD_MS. Slow / heavy bodies
// are "telegraphed" → higher dodge success.
function tryProjectileDodge(ragdoll, transients, now) {
  const chest = ragdoll.chest;
  const cx = chest.position.x, cy = chest.position.y;
  for (const b of transients) {
    if (!b.position || !b.velocity) continue;
    // Skip non-threats (treats, gifts, fire pools, handled by
    // praise / status systems, not "incoming damage").
    const pt = b.partType;
    if (pt === 'treat' || pt === 'gift' || pt === 'firepool') continue;

    const speed = Math.hypot(b.velocity.x, b.velocity.y);
    if (speed < 1) continue;

    // Predict position at lookahead
    const px = b.position.x + b.velocity.x * (PROJECTILE_LOOKAHEAD_MS / 16.67);
    const py = b.position.y + b.velocity.y * (PROJECTILE_LOOKAHEAD_MS / 16.67);
    const r = (b.circleRadius || 8) + 60; // generous threat box
    const dx = px - cx, dy = py - cy;
    if (dx * dx + dy * dy > r * r) continue;

    // Telegraphed = slow. Anvils, rockets, grenades.
    const telegraphed = speed < 8 || pt === 'grenade';
    const chance = telegraphed ? DODGE_PROBABILITY_SLOW : DODGE_PROBABILITY_FAST;
    if (Math.random() > chance) return false;

    // Dodge sideways AWAY from incoming x velocity. Magnitude scales with
    // panic so a frantic buddy hops harder.
    const dir = b.velocity.x > 0 ? -1 : 1;
    const mag = DODGE_IMPULSE_X * (1 + _state.panic * 0.6);
    Body.applyForce(chest, chest.position, { x: dir * mag, y: -mag * 0.5 });
    speakDodge(ragdoll);
    return true;
  }
  return false;
}

function tryCursorDodge(ragdoll, now) {
  const tool = getActiveTool();
  const def = TOOLS_BY_ID[tool];
  if (!def || def.spine !== 'negative') return false;
  const ms = getMouseState();
  if (!ms.mouseHover || !ms.isDown) return false;

  const chest = ragdoll.chest;
  const dx = chest.position.x - ms.lastX;
  const dy = chest.position.y - ms.lastY;
  const dist2 = dx * dx + dy * dy;
  if (dist2 > CURSOR_THREAT_RADIUS * CURSOR_THREAT_RADIUS) return false;

  if (Math.random() > DODGE_PROBABILITY_FAST) return false;
  const dir = dx >= 0 ? 1 : -1;  // away from cursor
  Body.applyForce(chest, chest.position, {
    x: dir * DODGE_IMPULSE_X,
    y: -DODGE_IMPULSE_X * 0.6,
  });
  speakDodge(ragdoll);
  return true;
}

// Dodge-line pools moved into src/personas/<id>.js in PR2. speakDodge reads
// from getPersona(id).aiFeedback.dodgeLines now; the per-persona file owns
// the strings. Falls back to '!' if a persona somehow lacks dodge lines.
function speakDodge(ragdoll) {
  const id = ragdoll.character.id;
  let pool = ['!'];
  try {
    const lines = getPersona(id)?.aiFeedback?.dodgeLines;
    if (Array.isArray(lines) && lines.length) pool = lines;
  } catch {
    // Unknown id, fall through to default.
  }
  const text = pool[Math.floor(Math.random() * pool.length)];
  popBubble(ragdoll.head, text);
}
