// Behavior scheduler, ambient idle motion + mood-driven body language.
// Runs from main.js inside the fixed-step loop, alongside applyStandPose.
// Composes by mutating ragdoll fields:
//   ragdoll._blinkClosed  , read by render/ragdoll.js drawExpression
//   ragdoll._poseOverride , read by physics/stand.js (per-partType cfg merge)
// And by applying small velocity/force impulses for joy bounces and cower
// nudges. Stays inside the velocity-blend safety envelope from CLAUDE.md.

import Matter from 'matter-js';
import { canvas } from '../state/world.js';
import { getMouseState } from '../input/mouse.js';
import { recentAffect } from '../mood.js';

const { Body } = Matter;

// Blink: eyes shut for ~120ms every 3-5s. Pure render flag, no physics.
const BLINK_INTERVAL_MIN = 3000;
const BLINK_INTERVAL_MAX = 5500;
const BLINK_DURATION_MS  = 120;

// Joy bounce: small upward chest impulse at high happiness/joy. Magnitude is
// well under the panic-run forces (PANIC_PUSH_X = 0.0018) so it never throws
// the figure off-balance.
const JOY_BOUNCE_INTERVAL_MS = 700;
const JOY_BOUNCE_FORCE       = 0.0035;

// Flee-to-corner: when fear is high, buddy actively runs toward the nearest
// screen edge instead of crouching in place. Canonical IB-1 behavior, "above
// a trauma threshold the buddy flees the cursor and hides in a corner."
// Head still tucks + arms still curl (scared body language) but locomotion
// is layered on top so the buddy is *moving*, not statue-cowering.
const FEAR_FLEE_THRESHOLD = 35;
const FLEE_FORCE          = 0.0022;     // stronger than live walk (0.0006)
const FLEE_HEAD_REST      = 0.32;
const FLEE_HEAD_BLEND     = 0.16;
const FLEE_ARM_PULL       = 0.18;

// Idle head look-around: pick a small angle every 3-6s. Reads as the buddy
// scanning its environment. Magnitude is tiny, head only, never enough to
// affect balance.
const LOOK_INTERVAL_MIN = 3000;
const LOOK_INTERVAL_MAX = 6000;
const LOOK_RANGE        = 0.32;     // ±~18°
const LOOK_BLEND        = 0.09;     // gentler than POSE.head 0.10 so motion is slow

function settled(ragdoll) {
  const now = performance.now();
  if (now < (ragdoll.stunUntil || 0)) return false;
  if (now < (ragdoll.limpUntil || 0)) return false;
  if (ragdoll.dragging) return false;
  return true;
}

export function tickBehavior(ctx, dtMs) {
  const { ragdoll, mood } = ctx;
  if (!ragdoll || !mood) return;
  const now = performance.now();

  // ---------- Blink ----------
  if (!ragdoll._blink) {
    ragdoll._blink = {
      closedUntil: 0,
      nextAt: now + BLINK_INTERVAL_MIN + Math.random() * (BLINK_INTERVAL_MAX - BLINK_INTERVAL_MIN),
    };
  }
  const blink = ragdoll._blink;
  if (now < blink.closedUntil) {
    ragdoll._blinkClosed = true;
  } else {
    ragdoll._blinkClosed = false;
    if (now >= blink.nextAt) {
      blink.closedUntil = now + BLINK_DURATION_MS;
      blink.nextAt = now + BLINK_INTERVAL_MIN + Math.random() * (BLINK_INTERVAL_MAX - BLINK_INTERVAL_MIN);
    }
  }

  // ---------- Joy bounce ----------
  if (settled(ragdoll)) {
    // Read the windowed positive signal so the buddy bounces in *response*
    // to recent praise, not because the session aggregate is high. Locks
    // off again once recentPos bleeds away (~3s halflife).
    const recent = recentAffect(mood);
    const joyHigh = (mood.joy || 0) > 30 || recent.pos > 18;
    if (joyHigh) {
      if (!ragdoll._joyBounce) ragdoll._joyBounce = { nextAt: now + JOY_BOUNCE_INTERVAL_MS };
      if (now >= ragdoll._joyBounce.nextAt) {
        Body.applyForce(ragdoll.chest, ragdoll.chest.position, {
          x: 0,
          y: -JOY_BOUNCE_FORCE * ragdoll.chest.mass,
        });
        ragdoll._joyBounce.nextAt = now + JOY_BOUNCE_INTERVAL_MS + Math.random() * 400;
      }
    } else {
      ragdoll._joyBounce = null;
    }
  }

  // ---------- Head look-around (idle) ----------
  if (!ragdoll._headLook) {
    ragdoll._headLook = {
      rest: 0,
      until: now + LOOK_INTERVAL_MIN + Math.random() * (LOOK_INTERVAL_MAX - LOOK_INTERVAL_MIN),
    };
  }
  if (now >= ragdoll._headLook.until) {
    ragdoll._headLook.rest = (Math.random() - 0.5) * LOOK_RANGE * 2;
    ragdoll._headLook.until = now + LOOK_INTERVAL_MIN + Math.random() * (LOOK_INTERVAL_MAX - LOOK_INTERVAL_MIN);
  }

  // ---------- Flee-to-corner (fear) ----------
  // Compose head pose: flee head-tuck wins over look-around when fear is high.
  const fleeing = (mood.fear || 0) > FEAR_FLEE_THRESHOLD && settled(ragdoll);
  const headRest  = fleeing ? FLEE_HEAD_REST  : ragdoll._headLook.rest;
  const headBlend = fleeing ? FLEE_HEAD_BLEND : LOOK_BLEND;
  ragdoll._poseOverride = { head: { rest: headRest, blend: headBlend } };
  ragdoll._fleeing = fleeing;  // live/index.js reads this to suppress idle walk

  if (fleeing) {
    const chest = ragdoll.chest;
    // Flee AWAY from the cursor (canonical IB-1: "above a trauma threshold the
    // buddy flees the cursor and hides in a corner"). Fall back to "toward
    // nearest edge" when the cursor is offscreen / not relevant.
    const stageW = canvas?.width || 1200;
    const ms = getMouseState();
    let fleeDir;
    if (ms?.mouseHover) {
      // Sign of (chest - cursor) on x-axis, positive when buddy is right
      // of cursor (flee right), negative when left (flee left).
      fleeDir = chest.position.x >= ms.lastX ? 1 : -1;
    } else {
      fleeDir = chest.position.x < stageW / 2 ? -1 : 1;
    }
    Body.applyForce(chest, chest.position, {
      x: fleeDir * FLEE_FORCE * chest.mass,
      y: 0,
    });
    // Pull arms inward toward chest for a "running scared" defensive curl.
    for (const arm of [ragdoll.bodyMap?.armL, ragdoll.bodyMap?.armR]) {
      if (!arm) continue;
      const dx = chest.position.x - arm.position.x;
      const dy = chest.position.y - arm.position.y;
      const d = Math.hypot(dx, dy) || 1;
      Body.setVelocity(arm, {
        x: arm.velocity.x + (dx / d) * FLEE_ARM_PULL,
        y: arm.velocity.y + (dy / d) * FLEE_ARM_PULL * 0.5,
      });
    }
  }
}
