// Rival brawler — Phase A (the summons-subsystem closer). A SECOND ragdoll that
// walks up to the player buddy and PUNCHES it. The first summon that is a full
// articulated rig (createRagdoll), not a single transient body — and the first
// time two ragdolls coexist. PHASE A is dealer-only + NON-DAMAGEABLE (the player
// cannot hurt it); the damageable Phase B (per-buddy mood/status/UI) is the
// gated Phase-6 multi-buddy milestone and is NOT built here.
//
// SEPARABILITY (planning + both red-team lenses: SEPARABLE, no Phase-6 refactor):
//   * NON-DAMAGEABLE for FREE — every damage path only touches ctx.ragdoll
//     (=_buddy); the rival is a separate composite, immune with zero collision edits.
//   * The rival STANDS via the EXISTING applyStandPose(ragdoll, gravityY) — it is
//     already parameterized + fully per-ragdoll (isGrounded builds a partSet from
//     ragdoll.parts), so calling it on a 2nd ragdoll is independent of the player's.
//   * Char-switch teardown via clearRival() in spawnRagdoll (beside clearFlood/
//     clearStrafe) + the controller-marker's lifeMs/onExpire. No dangling composite.
//   * Render via a 2nd renderRagdoll() call + a red wash in main.js (the "shadow
//     clone" look — the buddy's own rig/persona art, hostile red tint). 0 render edits.
//
// DISPATCH: the rival is a COMPOSITE, so it cannot itself be a _summonTick body.
// A tiny invisible CONTROLLER-MARKER (isSensor mask:0) rides transientBodies with
// _summonTick=rivalTick, keeping the rival in the summon family on the existing
// summons Mode (ZERO Mode edits) + inheriting the transient lifecycle (lifeMs
// despawn → onExpire=clearRival, char-switch wipe). rivalTick drives the composite.

import Matter from 'matter-js';
import { getStats } from '../_stats.js';
import { canvas, world } from '../../state/world.js';
import { createRagdoll } from '../../physics/ragdoll.js';
import { setRestAngles, applyStandPose, goLimp } from '../../physics/stand.js';
import { createMood, moodState } from '../../mood.js';
import * as P from '../../particles.js';
import { createStatusRegistry } from '../../effects/registry.js';
import { GRAVITY_Y, FLOOR_INSET, RAGDOLL_RIG_HEIGHT } from '../../physics/constants.js';
import { setRival, getRival, clearRival } from '../../state/rival.js';
import { sfx } from '../../audio/sfx.js';
import { startCooldown } from '../../ui/hotbar.js';
import { setEnabled } from '../../modes/bus.js';
import { SUMMONS_ID } from '../../modes/summons.js';
import { nearestPart, applyImpulseScaled, dirTo } from '../_shared.js';

const { Body, Bodies, Composite } = Matter;

// --- Module-const firewalls (a stat purchase can NEVER raise these) ---
const PUNCH_CEIL    = 0.07;    // Math.min ceiling on the per-mass punch (just above the player's punch ~0.05) — the only rival force on the buddy
const PUNCH_UPBIAS  = 0.0008;  // mass-scaled upward jerk on a punch (< COUNTER_GRAVITY_NEUTRALIZER 0.001288 → can't levitate a limb)
const SEEK_CEIL     = 0.0034;  // ceiling on the per-mass horizontal advance force (FLEE_FORCE band)
const JAB_VEL       = 2.2;     // tiny chest lunge velocity on a punch (cosmetic "jab" read), bounded
const DEFEAT_FLOP_MS = 700;    // crumple-and-vanish window after the rival's mood breaks (fork C = despawn-as-defeat)

export const defaultStats = {
  punchForce:     0.05,   // per-mass punch coeff (player-punch band; applyImpulseScaled ×part.mass)
  punchUpBias:    0.0008, // mass-scaled upward knock (< COUNTER_GRAVITY_NEUTRALIZER → no levitate)
  mood:           9,      // mood damage per landed punch
  punchIntervalMs: 900,   // per-rival punch throttle (~1.1/s); Boxer's tempo → 600
  punchRange:     75,     // px chest-to-nearest-part range that lands a punch (also the seek brake radius)
  seekForce:      0.0022, // per-mass horizontal advance toward the buddy (FLEE_FORCE); Relentless → 0.003
  lifeMs:         12000,  // finite brawl; the controller-marker despawns at bornAt+lifeMs → onExpire=clearRival (Relentless → 18000)
};

// Per-rival controller, dispatched by modes/summons.js via the marker's
// _summonTick. Reads LATCHED marker fields (not getStats per-step). Drives the
// rival COMPOSITE (held in state/rival.js): stand + advance + punch the buddy.
function rivalTick(marker, ctx) {
  const rival = getRival();
  if (!rival || !rival.ragdoll || !rival.ragdoll.parts || !rival.ragdoll.parts.length) { marker._spent = true; return; }
  const rag = rival.ragdoll;
  const now = performance.now();

  // DEFEAT (Phase 6, fork C = despawn-as-defeat): once the rival's OWN mood
  // breaks (sustained damage drove its happiness into BROKEN), it stops
  // fighting, crumples (goLimp), and despawns after a short flop — a visible
  // "you beat the challenger" beat instead of an instant vanish. Runs BEFORE the
  // stand driver so the body actually falls. clearRival here is safe: rivalTick
  // runs in the physics-phase summons tick BEFORE Engine.update (a wholesale
  // composite removal between force-apply and integrate, NOT a mid-solve
  // constraint release), and clearRival is idempotent.
  if (moodState(rival.mood).name === 'BROKEN') {
    if (!marker._defeatAt) {
      marker._defeatAt = now;
      goLimp(rag, DEFEAT_FLOP_MS + 200);
      sfx.rivalDefeat?.();
    } else if (now - marker._defeatAt >= DEFEAT_FLOP_MS) {
      const h = rag.head;
      if (h) P.burst(h.position.x, h.position.y, 16, { type: 'smoke', color: '#c81e1e', size: 16, life: 700, speedRange: 0.7, gravity: -0.0004 });
      clearRival();
      marker._spent = true;
    }
    return;   // defeated: no stand, no seek, no punch
  }

  // The rival STANDS via the proven, per-ragdoll-safe stand driver (independent
  // of the player's applyStandPose call in main.js). Runs in this physics-phase
  // tick (same lane as the player's), so the counter-gravity integrates correctly.
  applyStandPose(rag, GRAVITY_Y);

  const player = ctx.ragdoll;
  if (!player || !player.parts || !player.parts.length) return;   // no buddy → just stand

  const rcx = rag.chest.position.x, rcy = rag.chest.position.y;
  const nearest = nearestPart(player, rcx, rcy);
  const { nx, ny, dist } = dirTo(rcx, rcy, nearest.position.x, nearest.position.y);
  const dir = Math.sign(player.chest.position.x - rcx) || rag._facing || 1;

  // ADVANCE: a clamped horizontal force on the rival's chest toward the buddy,
  // until inside punch range (then brake — stand + brawl, don't shove through).
  if (dist > marker._punchRange) {
    Body.applyForce(rag.chest, rag.chest.position, { x: dir * Math.min(marker._seekForce, SEEK_CEIL) * rag.chest.mass, y: 0 });
  }
  rag._facing = dir;

  // PUNCH: the ONLY rival force on the BUDDY — a clamped impulse to the nearest
  // part, throttled per-rival. The rival passes THROUGH the buddy (adopted group)
  // so it reaches; the punch is the interaction, never a physical bulldoze.
  if (dist < marker._punchRange && now - (marker._lastPunchAt || 0) >= marker._punchIntervalMs) {
    marker._lastPunchAt = now;
    const mag = Math.min(marker._punchForce, PUNCH_CEIL);   // HARD ceiling — a stat can never raise past PUNCH_CEIL
    applyImpulseScaled(nearest, nx, ny, mag, Math.min(marker._punchUpBias, PUNCH_UPBIAS));
    // Tiny chest jab so the rival visibly lunges into the punch (bounded velocity nudge).
    Body.setVelocity(rag.chest, { x: rag.chest.velocity.x + dir * JAB_VEL, y: rag.chest.velocity.y });
    ctx.reactTo?.({
      source: 'rival_brawler', part: nearest, moodDelta: -marker._mood, impulse: mag,
      speakMs: nearest === player.head ? 500 : 99999,
    });
    ctx.screenShake?.(5, 110);
    sfx.rivalPunch?.();
  }
}

export default {
  id: 'rival_brawler',
  defaultStats,
  apply(ctx) {
    const s = getStats('rival_brawler');
    const { x, transientBodies, ragdoll } = ctx;
    if (!ragdoll || !ragdoll.parts || !ragdoll.parts.length) return;   // no buddy → no-op (also the shadow-clone source)

    // Single rival — replace any live one (drops the old composite + its marker
    // below). A char-switch already clears the rival via clearRival in spawnRagdoll.
    clearRival();
    for (let i = transientBodies.length - 1; i >= 0; i--) {
      if (transientBodies[i] && transientBodies[i].partType === 'rival_ctrl') {
        Composite.remove(world, transientBodies[i]); transientBodies.splice(i, 1);
      }
    }

    const now = performance.now();
    // Enter from the FAR edge from the buddy, feet near the floor (the spawnRagdoll
    // spawn-Y formula so the rival stands on the visible ground plane).
    const playerX = ragdoll.chest.position.x;
    const rivalX = playerX < canvas.width / 2 ? canvas.width - 80 : 80;
    const spawnY = Math.max(60, canvas.height - FLOOR_INSET - RAGDOLL_RIG_HEIGHT);
    const ch = ragdoll.character;                       // shadow clone: the buddy's own persona art (red-washed in render)
    const rag = createRagdoll(rivalX, spawnY, ch, 'rival');
    setRestAngles(rag);
    // Adopt the buddy's negative collision group → the rival passes THROUGH the
    // buddy (the punch impulse is the interaction, not a physical shove) while
    // still colliding with the floor/walls so it stands.
    const group = ragdoll.parts[0].collisionFilter.group;
    for (const p of rag.parts) p.collisionFilter.group = group;
    Composite.add(world, rag.composite);
    // Phase 6: a full Buddy (id + its OWN mood + status) so it is DAMAGEABLE —
    // collision routing resolves rival parts to this struct and applies damage
    // to rival.mood / rival.status (registered in the buddy registry by setRival).
    setRival({ id: 'rival', ragdoll: rag, mood: createMood(), status: createStatusRegistry(), epoch: ctx._epoch, spawnAt: now });

    // Invisible controller-marker (rides the summons Mode + the transient
    // lifecycle). NO render branch for 'rival_ctrl' → never drawn.
    const marker = Bodies.circle(rivalX, spawnY, 4, {
      isStatic: true, isSensor: true, collisionFilter: { mask: 0 },
      label: 'rival_ctrl', render: { visible: false },
    });
    marker.partType   = 'rival_ctrl';
    marker._summonTick = rivalTick;
    marker._verb       = ctx._verb || 'rival_brawler';
    marker.bornAt      = now;
    marker.lifeMs      = s.lifeMs ?? 12000;
    marker._epoch      = ctx._epoch;
    marker.onExpire    = () => clearRival();            // lifeMs despawn drops the rival composite
    marker._punchForce = s.punchForce ?? 0.05;
    marker._punchUpBias = s.punchUpBias ?? 0.0008;
    marker._mood = s.mood ?? 9;
    marker._punchIntervalMs = s.punchIntervalMs ?? 900;
    marker._punchRange = s.punchRange ?? 75;
    marker._seekForce = s.seekForce ?? 0.0022;
    marker._lastPunchAt = 0;
    Composite.add(world, marker);
    transientBodies.push(marker);

    setEnabled(SUMMONS_ID, true);   // wake the summons Mode; it self-disables when no summons remain
    sfx.rivalSummon?.();
    startCooldown('rival_brawler');
  },
  drawCursor(rctx, { x, y }) {
    // A small boxing-glove silhouette (place tool, no reticle).
    rctx.save();
    rctx.translate(x, y);
    rctx.fillStyle = '#c81e1e';
    rctx.beginPath(); rctx.arc(0, 0, 7, 0, Math.PI * 2); rctx.fill();         // glove
    rctx.fillRect(-9, 2, 8, 6);                                              // cuff
    rctx.fillStyle = '#8e1414';
    rctx.beginPath(); rctx.arc(3, -1, 2, 0, Math.PI * 2); rctx.fill();        // thumb crease
    rctx.restore();
  },
};
