// Per-part status-effect registry. Generic dispatch, each effect lives in
// its own module exporting a default { id, defaultDuration, layer, onApply?,
// onRemove?, onTick?, render? }.
//
// Storage: Map<partId, Map<effect, record>>. Records carry deadline + small
// effect-specific payload. tickStatuses runs inside the fixed-step loop in
// main.js so forces integrate this frame.
//
// Module-load circularity note: effect modules import { hasStatus, removeStatus }
// from this file. ES module live bindings + hoisted `export function` declarations
// resolve cleanly, those calls only fire at runtime, after both modules are loaded.

import onFire           from './on-fire.js';
import frozen           from './frozen.js';
import electrified      from './electrified.js';
import powered          from './powered.js';
import inBlackhole      from './in-blackhole.js';
import concussed        from './concussed.js';
import choking          from './choking.js';
import aligned          from './aligned.js';
import lashed           from './lashed.js';
import finishing        from './finishing.js';
import antitrustSplit   from './antitrust-split.js';
import bleed            from './bleed.js';
import corroded         from './corroded.js';
import wired            from './wired.js';
import * as P from '../particles.js';
import { getActiveChar } from '../ui/character-picker.js';
import { emit as emitTelemetry } from '../telemetry/events.js';

const EFFECTS = {
  on_fire:      onFire,
  frozen,
  electrified,
  powered,
  in_blackhole: inBlackhole,
  concussed,
  choking,
  // `aligned` retained as Compliance Theater event's producer.
  aligned,
  lashed,
  bleed,
  corroded,
  wired,
  finishing,
  // Mode events with teeth.
  antitrust_split: antitrustSplit,
};

// Block-roll observers, Compliance Theater registers one to drip +1¢
// per ALIGNED block fired. Listeners take the blocked part as an arg so
// per-buddy/per-event accounting stays possible. Returns an unsubscribe
// closure for the caller's cleanup.
const _blockListeners = new Set();

export function onBlock(cb) {
  _blockListeners.add(cb);
  return () => _blockListeners.delete(cb);
}
const EFFECT_LIST = Object.values(EFFECTS);

export function getEffect(id) { return EFFECTS[id] || null; }

// Registry-order list of every effect id. Lets registry-derived UIs (the dev
// panel's status painter) stay in sync as effects are added/removed instead of
// hardcoding the set.
export function listEffectIds() { return Object.keys(EFFECTS); }

export function createStatusRegistry() {
  return { map: new Map() };
}

export function applyStatus(reg, part, effect, opts = {}) {
  const eff = EFFECTS[effect];
  if (!eff) return null;
  const now = performance.now();
  const slot = reg.map.get(part.id) || new Map();
  const existing = slot.get(effect);
  // 'persistent' duration → expiresAt = Infinity. Status remains until an
  // opposing input calls removeStatus (or the ragdoll is replaced, which
  // clearAllStatus wipes). Used for fire/frozen, IB-style: state changes
  // because of an opposing input, not a clock running out.
  const duration = opts.duration ?? eff.defaultDuration ?? 1000;
  const expiresAt = duration === 'persistent' ? Infinity : now + duration;
  const rec = {
    effect,
    part,
    startedAt: existing?.startedAt ?? now,
    expiresAt,
    intensity: opts.intensity ?? 1,
    source: opts.source ?? null,
    character: opts.character ?? getActiveChar(),
    data: opts.data ?? null,
    onExpire: opts.onExpire ?? null,
  };
  slot.set(effect, rec);
  reg.map.set(part.id, slot);
  emitStatusApplied(rec, now);
  if (eff.onApply) eff.onApply(part, rec, reg);
  return rec;
}

export function removeStatus(reg, part, effect, reason = 'overridden') {
  const slot = reg.map.get(part.id);
  if (!slot) return;
  const rec = slot.get(effect);
  if (!rec) return;
  slot.delete(effect);
  emitStatusExpired(rec, reason);
  const eff = EFFECTS[effect];
  if (eff?.onRemove) eff.onRemove(part, rec, reg);
  if (rec.onExpire) rec.onExpire(rec, /*natural*/ false);
}

export function hasStatus(reg, part, effect) {
  return !!reg.map.get(part.id)?.has(effect);
}

export function getStatus(reg, part, effect) {
  return reg.map.get(part.id)?.get(effect) || null;
}

export function clearAll(reg) {
  for (const slot of reg.map.values()) {
    for (const rec of slot.values()) {
      emitStatusExpired(rec, 'cleared');
      const eff = EFFECTS[rec.effect];
      if (eff?.onRemove) eff.onRemove(rec.part, rec, reg);
      if (rec.onExpire) rec.onExpire(rec, /*natural*/ false);
    }
  }
  reg.map.clear();
}

export function forEachActive(reg, cb) {
  const now = performance.now();
  for (const [, slot] of reg.map) {
    for (const [, rec] of slot) {
      if (now >= rec.expiresAt) continue;
      cb(rec);
    }
  }
}

export function tickStatuses(reg, ragdoll, ctx, dtMs) {
  const now = performance.now();
  for (const [partId, slot] of reg.map) {
    for (const [effect, rec] of slot) {
      if (now >= rec.expiresAt) {
        slot.delete(effect);
        emitStatusExpired(rec, 'natural');
        const eff = EFFECTS[effect];
        if (eff?.onRemove) eff.onRemove(rec.part, rec, reg);
        if (rec.onExpire) rec.onExpire(rec, /*natural*/ true);
        continue;
      }
      const eff = EFFECTS[effect];
      if (eff?.onTick) eff.onTick(rec.part, rec, ctx, dtMs, now);
    }
    if (slot.size === 0) reg.map.delete(partId);
  }
}

export function isBrittle(reg, part) {
  return hasStatus(reg, part, 'frozen');
}

// Multiplier applied to mood-damage of the next impact-tier hit on this part.
// Stack semantics:
//   - ALIGNED checked FIRST. 30% chance to fully block (return 0). The
//     model "refuses" the attack; concussed/etc. do not consume because
//     mul never crossed > 1.
//   - Concussed (×1.5) and antitrust_split (×2) stack multiplicatively
//     when the hit lands.
// Buddy-wide statuses (aligned/antitrust_split) are stored on the head
// canonically but checked via `buddyHas()` so the multiplier fires
// regardless of which part takes the hit. Concussed stays per-part
// (you can concuss the leg without affecting head hits).
// Callers consume the *concussed* buff via consumeConcussed() once
// they've applied the multiplied damage; for AOE callers (explode),
// pass the part that owns the buff so we don't consume twice.
export function buddyHas(reg, effect) {
  for (const slot of reg.map.values()) {
    if (slot.has(effect)) return true;
  }
  return false;
}

export function damageMul(reg, part) {
  if (!part) return 1;
  // FINISHING, buddy is in the coup de grâce kill window. Voids damage
  // entirely; the ability's own setTimeout pays the wipe.
  if (buddyHas(reg, 'finishing')) return 0;
  if (buddyHas(reg, 'aligned') && Math.random() < 0.30) {
    for (const cb of _blockListeners) {
      try { cb(part); } catch (e) { console.warn('block listener threw', e); }
    }
    // REFUSED visual, small blue spark burst at the blocked part. Without
    // this, a 30% block during Compliance Theater is silent and reads as
    // a missed hit. showCombo is a no-op (banners were noise) so the
    // signal goes here, anchored to the part.
    P.burst(part.position.x, part.position.y, 8, {
      type: 'spark', color: '#7ec8ff', size: 3, life: 380, speedRange: 1.0, gravity: -0.0002,
    });
    return 0;
  }
  let mul = 1;
  if (hasStatus(reg, part, 'concussed'))      mul *= 1.5;
  if (hasStatus(reg, part, 'corroded'))       mul *= 1.4;   // UP, per-part, NOT consumed
  if (buddyHas(reg, 'antitrust_split'))       mul *= 2;
  if (hasStatus(reg, part, 'wired'))          mul *= 0.5;   // DOWN, defensive toughness
  return mul;
}

export function consumeConcussed(reg, part) {
  if (!part) return false;
  if (!hasStatus(reg, part, 'concussed')) return false;
  removeStatus(reg, part, 'concussed');
  // CRACKED payoff burst, yellow stars exploding outward from the part as
  // the orbiting concussed-stars are consumed. Centralized here so every
  // consumer (punch / hammer / sword / shotgun / sawblade / chainsaw /
  // meathook) gets the visual without per-call edits. showCombo is
  // intentionally a no-op (the centered banners were noise), this is the
  // replacement signal at the part's position.
  P.burst(part.position.x, part.position.y, 12, {
    type: 'star', color: '#ffe27a', size: 5, life: 520, speedRange: 1.4, gravity: -0.0002,
  });
  P.burst(part.position.x, part.position.y, 6, {
    type: 'spark', color: '#fff', size: 3, life: 280, speedRange: 1.6,
  });
  return true;
}

// Find the first part inside an explosion radius that has concussed, so the
// caller can consume it exactly once per blast even though many parts may be
// hit. Returns null if no part inside the radius is concussed.
export function findConcussedInRange(reg, ragdoll, x, y, radius) {
  for (const p of ragdoll.parts) {
    const dx = p.position.x - x, dy = p.position.y - y;
    if (Math.hypot(dx, dy) <= radius && hasStatus(reg, p, 'concussed')) return p;
  }
  return null;
}

function telemetryPart(part) {
  if (!part) return null;
  if (part.partType === 'foot') return 'leg';
  if (part.partType === 'head' || part.partType === 'torso' || part.partType === 'arm' || part.partType === 'leg') {
    return part.partType;
  }
  return null;
}

function emitStatusApplied(rec, now) {
  const part = telemetryPart(rec.part);
  if (!part) return;
  emitTelemetry({
    type: 'status_applied',
    effect: rec.effect,
    character: rec.character,
    part,
    source_verb: rec.source || 'unknown',
    duration_ms: Number.isFinite(rec.expiresAt)
      ? Math.max(0, Math.round(rec.expiresAt - now))
      : 0,
    ...(rec.intensity !== undefined ? { intensity: rec.intensity } : {}),
  });
}

function emitStatusExpired(rec, reason) {
  const part = telemetryPart(rec.part);
  if (!part) return;
  emitTelemetry({
    type: 'status_expired',
    effect: rec.effect,
    character: rec.character,
    part,
    reason,
  });
}

// Collects active records per effect-layer, dispatches to each effect's render.
// Called by render.js once for 'under' (before body) and once for 'over' (after).
export function renderStatusOverlays(rctx, ragdoll, reg, layer, now) {
  for (const eff of EFFECT_LIST) {
    if (eff.layer !== layer) continue;
    if (!eff.render) continue;
    const records = [];
    for (const p of ragdoll.parts) {
      const rec = reg.map.get(p.id)?.get(eff.id);
      if (rec && now < rec.expiresAt) records.push({ part: p, rec });
    }
    if (!records.length) continue;
    eff.render(rctx, ragdoll, records, now);
  }
}
