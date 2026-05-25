// Locomotion primitives for status effects. Each primitive is called from
// inside a status effect's onTick; they all bail when the ragdoll is stunned
// (full flop wins) or tipped over (legs can't push if the body is sideways).
//
// State that needs to be coherent across body parts (e.g. the panic-run
// direction so both legs push the same way) lives on the ragdoll itself,
// keyed by `_panic` etc. Garbage-collected with the ragdoll on respawn.

import Matter from 'matter-js';
const { Body } = Matter;

const TWO_PI = Math.PI * 2;
function wrapAngle(a) {
  a = a % TWO_PI;
  if (a > Math.PI) a -= TWO_PI;
  else if (a < -Math.PI) a += TWO_PI;
  return a;
}

function settled(ragdoll) {
  const now = performance.now();
  if (now < (ragdoll.stunUntil || 0)) return false;
  return Math.abs(wrapAngle(ragdoll.chest.angle)) < Math.PI / 2;
}

// Burning-leg push: each call applies a sideways force to one leg, scaled by
// mass. Direction is shared across both legs via ragdoll._panic so they run
// in step. Direction flips every 400-800ms so the buddy zigzags rather than
// disappearing off one side. Chest gets a complementary lean-into-run push
// so the body actually translates instead of flailing in place.
const PANIC_PUSH_X = 0.0018;
const PANIC_PUSH_Y = -0.00065;
const PANIC_LEAN_X = 0.0012;
export function panicRunLeg(ragdoll, leg) {
  if (leg.partType !== 'leg') return;
  if (!settled(ragdoll)) return;
  const now = performance.now();
  if (!ragdoll._panic) {
    ragdoll._panic = {
      dir: Math.random() < 0.5 ? -1 : 1,
      flipAt: now + 600 + Math.random() * 600,
    };
  }
  if (now > ragdoll._panic.flipAt) {
    ragdoll._panic.dir *= -1;
    ragdoll._panic.flipAt = now + 600 + Math.random() * 600;
  }
  Body.applyForce(leg, leg.position, {
    x: ragdoll._panic.dir * PANIC_PUSH_X * leg.mass,
    y: PANIC_PUSH_Y * leg.mass,
  });
  // Lean the chest into the run so the body actually moves with the legs.
  // Only push once per pair, gate on the left leg.
  if (leg.id === ragdoll.bodyMap?.legL?.id) {
    Body.applyForce(ragdoll.chest, ragdoll.chest.position, {
      x: ragdoll._panic.dir * PANIC_LEAN_X * ragdoll.chest.mass,
      y: 0,
    });
  }
}

// Frozen shiver: tiny rapid trembles on torso/head (and a wisp on arms),
// reads as "buddy is cold and scared". Velocity-additive, low magnitude so
// it doesn't fight the freeze lockout visual.
export function shiver(part) {
  if (part.partType === 'leg') return;
  const mag = part.partType === 'arm' ? 0.12 : 0.22;
  Body.setVelocity(part, {
    x: part.velocity.x + (Math.random() - 0.5) * mag,
    y: part.velocity.y + (Math.random() - 0.5) * mag * 0.5,
  });
  Body.setAngularVelocity(part, part.angularVelocity + (Math.random() - 0.5) * 0.06);
}

// Electrified jolt: stronger whole-body convulsion. Used for non-arm parts
// so the entire silhouette shakes when current flows, not just the arms.
export function jolt(part) {
  Body.setVelocity(part, {
    x: part.velocity.x + (Math.random() - 0.5) * 0.4,
    y: part.velocity.y + (Math.random() - 0.5) * 0.3,
  });
  Body.setAngularVelocity(part, part.angularVelocity + (Math.random() - 0.5) * 0.35);
}

// Flinch: brief "wince" pose triggered on hit. Head tucks down, arms pull in
// toward chest, torso recoils away from impact. Velocity-additive, physics
// resolves it back to upright within ~250ms. Used by punch/hammer/lightsaber
// for the "ouch" read; explosions already produce dramatic motion so they
// skip it.
export function flinch(ragdoll, hitX, hitY, intensity = 1) {
  const { head, chest, bodyMap } = ragdoll;
  if (!head || !chest || !bodyMap) return;
  // Head tucks down + small horizontal jitter
  Body.setVelocity(head, {
    x: head.velocity.x + (Math.random() - 0.5) * 0.4 * intensity,
    y: head.velocity.y + 0.5 * intensity,
  });
  Body.setAngularVelocity(head, head.angularVelocity + (Math.random() - 0.5) * 0.15 * intensity);
  // Torso recoils away from hit point
  const dx = chest.position.x - hitX;
  const dy = chest.position.y - hitY;
  const d = Math.hypot(dx, dy) || 1;
  const recoilMag = 0.6 * intensity;
  Body.setVelocity(chest, {
    x: chest.velocity.x + (dx / d) * recoilMag,
    y: chest.velocity.y + (dy / d) * recoilMag * 0.5,
  });
  // Arms pull inward toward chest (defensive curl)
  for (const arm of [bodyMap.armL, bodyMap.armR]) {
    if (!arm) continue;
    const adx = chest.position.x - arm.position.x;
    const ady = chest.position.y - arm.position.y;
    const ad = Math.hypot(adx, ady) || 1;
    Body.setVelocity(arm, {
      x: arm.velocity.x + (adx / ad) * 0.4 * intensity,
      y: arm.velocity.y + (ady / ad) * 0.3 * intensity,
    });
  }
}

// Concussed wobble: random small jitter on torso/head. Velocity-additive so
// it overlays cleanly on whatever else is happening (gravity, drag).
export function stagger(part) {
  if (part.partType !== 'torso' && part.partType !== 'head') return;
  Body.setVelocity(part, {
    x: part.velocity.x + (Math.random() - 0.5) * 0.5,
    y: part.velocity.y + (Math.random() - 0.5) * 0.25,
  });
  Body.setAngularVelocity(part, part.angularVelocity + (Math.random() - 0.5) * 0.08);
}

// Electrified vibration: tiny rapid jolts on arms, reads as "shaking from
// the current." Small enough to not throw the body around.
export function microFlail(part) {
  if (part.partType !== 'arm') return;
  Body.setAngularVelocity(part, part.angularVelocity + (Math.random() - 0.5) * 0.25);
  Body.setVelocity(part, {
    x: part.velocity.x + (Math.random() - 0.5) * 0.2,
    y: part.velocity.y + (Math.random() - 0.5) * 0.2,
  });
}
