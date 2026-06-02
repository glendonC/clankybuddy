// @ts-check
// Centralized ability ctx so we never forget a field at a call site. Every
// ability receives the object built by abilityCtx(). Add a new field here and
// every ability sees it, and update the AbilityCtx typedef in src/types.js.
//
// NOTE: `ragdoll` and `_epoch` are read at call time (not closure-captured)
// so the ctx always reflects the current spawn. Delayed setTimeout callbacks
// touching the ragdoll must capture _epoch and call _epochValid(saved) before
// firing, see CLAUDE.md.
//
// Reads from getCurrentBuddy(), see Buddy in state/ragdoll-lifecycle.js.

import {
  transientBodies, getCurrentBuddy, epochValid,
} from './ragdoll-lifecycle.js';
import { canvas, world } from './world.js';
import { hitStop } from './time.js';
import { spawnFirePool } from '../transients/firepool.js';
import { screenShake } from '../ui/screen-shake.js';
import { popBubble } from '../ui/speech-bubbles.js';
import { getActiveChar } from '../ui/character-picker.js';
import { emit, getSessionId } from '../telemetry/events.js';
import { addCurrency } from '../progression/state.js';
import { getMasterMul } from '../progression/master-mults.js';
import { applyMoodDelta } from '../mood.js';
import { react } from '../reactions/index.js';

// Base award for any 2+ verb combo. The master-tree "Combo Curator" node
// adds the +100% via comboBonusMul (default 1 → no bonus when unowned).
// Per-verb step gives long combos a meaningful payout without runaway scaling.
const COMBO_BASE_BONUS    = 5;
const COMBO_PER_VERB_STEP = 2;

/** @typedef {import('../types.js').AbilityCtx} AbilityCtx */

const HIT_COMBO_IDLE_MS = 600;
const hitCombo = { sessionId: '', lastAt: 0, index: 0 };
let pendingCombo = null;
let comboTimer = 0;

/**
 * Build an ability ctx bound to a SPECIFIC buddy. Used by collision routing
 * (Phase 6): when a hit resolves to the rival, the handler must run against the
 * rival's ragdoll/mood/status, and reactTo/recordHit must close over THAT ctx
 * (spreading {...ctx, mood} would leave reactTo bound to the old mood). Building
 * a fresh ctx per buddy is the only correct rebind.
 * @param {{id:string, ragdoll:any, mood:any, status:any, epoch:number}} b
 * @param {Partial<AbilityCtx>} [extra]
 * @returns {AbilityCtx}
 */
export function abilityCtxFor(b, extra = {}) {
  const ctx = {
    buddyId: b.id,
    ragdoll: b.ragdoll, mood: b.mood, status: b.status, world,
    transientBodies,
    screenShake, popBubble, hitStop,
    _spawnFirePool: (x, y, durationMs) => spawnFirePool(world, transientBodies, canvas.height, x, y, durationMs),
    _epoch: b.epoch,
    _epochValid: epochValid,
    ...extra,
  };
  ctx.recordHit = (hit) => recordHit(ctx, hit);
  ctx.reactTo = (req) => reactTo(ctx, req);
  return ctx;
}

/**
 * @param {Partial<AbilityCtx>} [extra]
 * @returns {AbilityCtx}
 */
export function abilityCtx(extra = {}) {
  return abilityCtxFor(getCurrentBuddy(), extra);
}

// SHOCK_NORM, mood-delta magnitude that yields intensity=1. Calibrated so a
// single hammer hit (-16) → ~0.64 intensity; a fireball blast share (-22) →
// ~0.88; an anvil-direct (-50) → saturated. Pet (+1) → 0.04 (well under
// SHOCK_FACE_MIN's threshold so no wince on praise).
const SHOCK_NORM = 25;

// Single chokepoint that abilities call instead of hand-rolling
// `applyMoodDelta + recordHit + maybeSpeak + popBubble`. Gives the buddy
// a unified reaction surface: face/posture (via mood.shock auto-spike inside
// applyMoodDelta), pool-keyed speech (via react()), and telemetry, all
// from one call site. Stimulus key is `source` (matches the persona pool
// key in src/personas/<id>.js, e.g. 'punch' / 'fireball' / 'pet').
//
// Inferred fields: when caller omits `intensity`, derives it from
// |moodDelta| so the shock channel matches the damage tier without callers
// repeating the math. `kind` is inferred from moodDelta sign, callers
// override only for edge cases (e.g. rejected punch returns +mood but is
// still a 'hit' for telemetry).
function reactTo(ctx, req = {}) {
  const {
    source,
    part,
    moodDelta = 0,
    intensity,
    impulse,
    speakMs = 500,
    kind,
  } = req;
  const verb = source || ctx._verb;
  if (moodDelta) applyMoodDelta(ctx.mood, moodDelta);
  const normIntensity = Math.min(1,
    Number.isFinite(intensity) ? intensity : Math.abs(moodDelta) / SHOCK_NORM);
  const inferredKind = kind || (moodDelta < 0 ? 'hit' : moodDelta > 0 ? 'reward' : 'neutral');
  if (part && moodDelta) {
    ctx.recordHit?.({
      part,
      moodDelta,
      intensity: normIntensity,
      impulse,
      verb,
      kind: inferredKind,
    });
  }
  let spoken = null;
  if (part && verb) {
    spoken = react({
      event: verb,
      mood: ctx.mood,
      part,
      minIntervalMs: speakMs,
    });
  }
  return spoken;
}

export function flushPendingHitCombo() {
  completePendingCombo();
}

function recordHit(ctx, hit = {}) {
  const part = telemetryPart(hit.part);
  const moodDelta = Number(hit.moodDelta);
  if (!part || !Number.isFinite(moodDelta) || moodDelta === 0) return;

  const now = performance.now();
  const sessionId = getSessionId();
  if (hitCombo.sessionId !== sessionId || now - hitCombo.lastAt > HIT_COMBO_IDLE_MS) {
    completePendingCombo();
    hitCombo.sessionId = sessionId;
    hitCombo.index = 0;
  } else {
    hitCombo.index += 1;
  }
  hitCombo.lastAt = now;
  const verb = hit.verb || ctx._verb || 'unknown';
  const character = hit.character || getActiveChar();

  const buddyId = hit.part?.buddyId || ctx.buddyId || 'main';
  emit({
    type: 'hit_landed',
    verb,
    character,
    buddy_id: buddyId,
    part,
    // `impulse` is the raw physics magnitude, UNITS VARY per caller (force
    // vs velocity). Kept for backwards compatibility with anything reading
    // the wire format; prefer `intensity` (0–1 normalized, derived from
    // |moodDelta|/SHOCK_NORM) for cross-ability comparisons.
    impulse: finiteNumber(hit.impulse),
    intensity: finiteNumber(hit.intensity),
    mood_delta: moodDelta,
    active_effects: activeEffects(ctx.status, hit.part),
    brittle: hasEffect(ctx.status, hit.part, 'frozen'),
    combo_index: hit.comboIndex ?? hitCombo.index,
  });
  appendComboHit({ sessionId, now, character, buddyId, verb, part, moodDelta });
}

function telemetryPart(part) {
  if (!part) return null;
  if (part.partType === 'foot') return 'leg';
  if (part.partType === 'head' || part.partType === 'torso' || part.partType === 'arm' || part.partType === 'leg') {
    return part.partType;
  }
  return null;
}

function activeEffects(status, part) {
  if (!status || !part) return [];
  const slot = status.map.get(part.id);
  if (!slot) return [];
  return [...slot.keys()];
}

function hasEffect(status, part, effect) {
  if (!status || !part) return false;
  return !!status.map.get(part.id)?.has(effect);
}

function finiteNumber(value) {
  return Number.isFinite(value) ? value : 0;
}

function appendComboHit({ sessionId, now, character, buddyId, verb, part, moodDelta }) {
  if (
    !pendingCombo ||
    pendingCombo.sessionId !== sessionId ||
    pendingCombo.character !== character ||
    now - pendingCombo.lastAt > HIT_COMBO_IDLE_MS
  ) {
    completePendingCombo();
    pendingCombo = {
      sessionId,
      character,
      buddyIds: new Set(),
      startedAt: now,
      lastAt: now,
      verbs: [],
      parts: [],
      totalMoodDelta: 0,
    };
  }
  pendingCombo.lastAt = now;
  pendingCombo.verbs.push(verb);
  pendingCombo.parts.push(part);
  pendingCombo.totalMoodDelta += moodDelta;
  if (buddyId) pendingCombo.buddyIds.add(buddyId);
  scheduleComboCompletion();
}

function scheduleComboCompletion() {
  if (comboTimer) clearTimeout(comboTimer);
  comboTimer = setTimeout(() => {
    comboTimer = 0;
    completePendingCombo();
  }, HIT_COMBO_IDLE_MS + 40);
}

function completePendingCombo() {
  if (!pendingCombo) return;
  const combo = pendingCombo;
  pendingCombo = null;
  if (comboTimer) {
    clearTimeout(comboTimer);
    comboTimer = 0;
  }
  if (combo.verbs.length < 2) return;
  // Combo bonus currency, Combo Curator (master tree) doubles this via
  // comboBonusMul. Scales with combo length so longer combos pay better.
  const bonusBase = COMBO_BASE_BONUS + (combo.verbs.length - 2) * COMBO_PER_VERB_STEP;
  const mul = getMasterMul('comboBonusMul') || 1;
  const bonusAward = Math.max(0, Math.round(bonusBase * mul));
  if (bonusAward > 0) {
    addCurrency(bonusAward);
    emit({
      type: 'currency_earned',
      amount: bonusAward,
      reason: 'combo',
      character: combo.character,
    });
  }
  emit({
    type: 'combo_completed',
    character: combo.character,
    // buddy_ids enumerates every buddy hit during the combo window. Today
    // always ['main']; in Swarm mode a combo that crosses two buddies will
    // carry both ids without losing attribution.
    buddy_ids: combo.buddyIds ? [...combo.buddyIds] : [],
    verbs: combo.verbs,
    duration_ms: Math.max(0, Math.round(combo.lastAt - combo.startedAt)),
    total_mood_delta: combo.totalMoodDelta,
    parts_hit: combo.parts,
  });
}
