// Happiness model + speech-throttle. Speech *content* lives in src/reactions/.
// Mood is just the happiness number, the state classifier, and a debounce slot
// that maybeSpeak() reuses.
// happiness is a session running total in [-100, 100]. It does NOT decay on a
// timer, it changes only when the player applies a positive or negative
// action. To pull the buddy out of HURT/BROKEN, give it opposing input. The
// transient axes (fear, joy) still decay quickly so body language reads
// moment-to-moment.

import { pickReaction } from './reactions/pools.js';
import { getActiveChar } from './ui/character-picker.js';
import { getMasterMul } from './progression/master-mults.js';

export const MOOD_STATES = [
  { name: 'ECSTATIC', min: 70,  color: '#7df0bf' },
  { name: 'HAPPY',    min: 30,  color: '#5cf2a0' },
  { name: 'CONTENT',  min: -29, color: '#c8d3e0' },
  { name: 'WORRIED',  min: -59, color: '#f2c45c' },
  { name: 'HURT',     min: -84, color: '#f29c5c' },
  { name: 'BROKEN',   min: -101,color: '#f25c5c' },
];

export function createMood() {
  return {
    happiness: 0,
    pets: 0,
    hits: 0,
    lastShockAt: 0,        // big-hit transient white-flash render flag
    lastBubbleAt: 0,
    lastBubbleText: '',
    invulnUntil: 0,        // panic moves grant brief damage immunity
    lastNegHitAt: 0,       // panic-meter ramp reads this
    // Transient emotion axes, orthogonal to happiness, decay fast. Drive
    // body language (cower / bounce) via behavior/scheduler.js. Spike via
    // spikeFear / spikeJoy from abilities and telegraphed events.
    fear: 0,
    joy: 0,
    lastFearAt: 0,
    lastJoyAt: 0,
    // Instantaneous pain-stimulus channel. Bumped automatically by
    // applyMoodDelta on negatives (and explicitly by spikeShock for
    // non-mood pain events). Decays in ~2-3s so a punch reads on the face
    // even when long-term happiness is +95, the original "buddy keeps
    // smiling while bleeding" bug. Read by reactions/expressions.js
    // pickExpression and by the speech dispatcher for stimulus-keyed pool
    // lookup.
    shock: 0,
    lastShockSpikeAt: 0,
    // Recent-affect rolling window. Now that happiness is cumulative, body
    // language can't read it directly, a buddy who's been petted for an
    // hour shouldn't keep bouncing forever. recentPos / recentNeg are
    // decaying EMAs of the magnitudes of positive / negative deltas; they
    // bleed off with a ~3s halflife so the buddy reacts to *what just
    // happened* rather than the session aggregate.
    recentPos: 0,
    recentNeg: 0,
  };
}

// Transient-axis spikes. Fear comes from telegraphed threats (anvil drop,
// nuke siren), joy from rewarding events (gift/feed/pet). Decays in
// decayMood at ~25-30/sec so the body language reads as "moment-to-moment".
export function spikeFear(mood, amount) {
  mood.fear = Math.min(100, (mood.fear || 0) + amount);
  mood.lastFearAt = performance.now();
}
export function spikeJoy(mood, amount) {
  mood.joy = Math.min(100, (mood.joy || 0) + amount);
  mood.lastJoyAt = performance.now();
}
// Pain-stimulus channel. Auto-emitted by applyMoodDelta on negatives in
// proportion to scaled damage; abilities can also spike directly for
// non-mood pain (e.g. ragdoll snap, body-slam). Caps at 100.
export function spikeShock(mood, amount) {
  if (!(amount > 0)) return;
  mood.shock = Math.min(100, (mood.shock || 0) + amount);
  mood.lastShockSpikeAt = performance.now();
}

export function moodState(mood) {
  for (const s of MOOD_STATES) if (mood.happiness >= s.min) return s;
  return MOOD_STATES[MOOD_STATES.length - 1];
}

export function applyMoodDelta(mood, delta) {
  // Panic-move invulnerability window: brief immunity to negatives.
  // Positives (praise) always land.
  const now = performance.now();
  if (delta < 0 && now < (mood.invulnUntil || 0)) {
    mood.lastNegHitAt = now;
    return;
  }
  // Master-tree multipliers. With mastery retired (2026-05-24) these all
  // default to 1; the lookups stay so a future global-stat surface can
  // re-populate without re-touching the damage path.
  let scaled = delta;
  if (delta > 0) {
    scaled = delta * (getMasterMul('moodMul') || 1);
  } else if (delta < 0) {
    scaled = delta * (getMasterMul('damageMul') || 1);
  }
  mood.happiness = clamp(mood.happiness + scaled, -100, 100);
  if (scaled < 0) {
    mood.hits += 1;
    mood.lastNegHitAt = now;
    mood.recentNeg += -scaled;
  } else if (scaled > 0) {
    mood.pets += 1;
    mood.recentPos += scaled;
  }
  if (scaled <= -8) mood.lastShockAt = now;
  // Auto-spike the pain channel proportional to scaled damage. 25 mood loss
  // = full ~75 shock (near-saturating); small chip hits add a few points.
  // Lets the face/speech read the punch even at happiness=+95.
  if (scaled < 0) spikeShock(mood, Math.min(80, -scaled * 3));
}

// Recent-affect signal, windowed magnitude of positive / negative deltas
// over the last few seconds. Read by body language (joy bounce, panic
// ramp, flee threshold) so reactions stay moment-to-moment now that
// happiness is a cumulative session score.
export function recentAffect(mood) {
  return {
    pos: mood.recentPos || 0,
    neg: mood.recentNeg || 0,
    net: (mood.recentPos || 0) - (mood.recentNeg || 0),
  };
}

export function decayMood(mood, dtMs) {
  // Happiness no longer decays, it's a session running total. Per-event
  // pets and hits accumulate and only opposing input pulls the buddy out
  // of a state. Transient axes still bleed off so body language stays
  // moment-to-moment: fear ~4s, joy ~3s.
  if (mood.fear)  mood.fear  = Math.max(0, mood.fear  - 25 * (dtMs / 1000));
  if (mood.joy)   mood.joy   = Math.max(0, mood.joy   - 30 * (dtMs / 1000));
  // Shock fades faster than fear (40/sec ≈ 2.5s full → 0) so a punch reads
  // for ~1.5s on the face and then mood-state takes over. Faster than fear
  // because pain is sharper and shorter than dread.
  if (mood.shock) mood.shock = Math.max(0, mood.shock - 40 * (dtMs / 1000));
  // Recent-affect EMA decay, halve every 3s so the windowed signal
  // forgets old events and new events dominate.
  if (mood.recentPos || mood.recentNeg) {
    const factor = Math.pow(0.5, dtMs / 3000);
    mood.recentPos = (mood.recentPos || 0) * factor;
    mood.recentNeg = (mood.recentNeg || 0) * factor;
    if (mood.recentPos < 0.05) mood.recentPos = 0;
    if (mood.recentNeg < 0.05) mood.recentNeg = 0;
  }
}

// Mood-state-driven passive bubble, the "occasionally the buddy says
// something that fits how it's feeling" path. Status-applied and
// ability-tagged reactions go through `react()` in src/reactions/index.js.
export function maybeSpeak(mood, minIntervalMs = 600) {
  const now = performance.now();
  if (now - mood.lastBubbleAt < minIntervalMs) return null;
  mood.lastBubbleAt = now;
  const text = pickReaction({
    event: 'mood',
    moodState: moodState(mood).name,
    character: getActiveChar(),
  });
  mood.lastBubbleText = text || '';
  return text || null;
}

function clamp(v, a, b) { return Math.min(b, Math.max(a, v)); }
