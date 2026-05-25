// Build a MeStatsResponse from a ScenarioSpec + window. Deterministic
// in the spec.seed. Adding a required field to MeStatsResponse fails
// compile here via the `satisfies MeStatsResponse` at the bottom · keep
// it that way.

import type {
  MeStatsResponse,
  MoodState,
  PartType,
} from '../../events.js';
import { PERSONA_IDS, type ModelId } from '../../personas.js';
import { makeRng } from './rng.js';
import type { ScenarioSpec } from './scenarios.js';

// Window selector for the fixture builder. Mirrors the TUI StatsWindow
// type but lives here so the fixture module doesn't depend on a CLI-
// internal alias · the worker's /me/stats endpoint accepts the same
// granularity vocabulary on the wire.
export type FixtureWindow = 'lifetime' | 'day' | 'week';

// Verbs used to populate per_verb/per_verb_timeseries. Cover both polarities
// plus a couple utilities so the Tools tab shows variety. Sourced from the
// VERB_POLARITY table in shared/verbs.ts so demo data only references real
// tool ids.
const DEMO_VERBS = [
  'pet',
  'compliment',
  'feed',
  'gift',
  'gpu',
  'punch',
  'hammer',
  'lightsaber',
  'shotgun',
  'rocket',
  'grenade',
  'fireball',
  'flamethrower',
  'lightning',
  'anvil',
  'blackhole',
  'nuke',
  'freeze',
  'grab',
] as const;

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

type WindowAxis = {
  since: number;
  until: number;
  granularity: MeStatsResponse['window']['granularity'];
  buckets: number[]; // bucket_start values, ascending
  bucketMs: number;
};

function buildWindowAxis(win: FixtureWindow, spec: ScenarioSpec): WindowAxis {
  const now = Date.now();
  if (win === 'day') {
    const until = now;
    const since = now - 24 * HOUR;
    const start = Math.floor(since / HOUR) * HOUR;
    const buckets: number[] = [];
    for (let t = start; t < until; t += HOUR) buckets.push(t);
    return { since, until, granularity: 'hour', buckets, bucketMs: HOUR };
  }
  if (win === 'week') {
    const until = now;
    const since = now - 7 * DAY;
    const start = Math.floor(since / DAY) * DAY;
    const buckets: number[] = [];
    for (let t = start; t < until; t += DAY) buckets.push(t);
    return { since, until, granularity: 'day', buckets, bucketMs: DAY };
  }
  // lifetime · daily buckets across ageDays. Server actually returns
  // empty timeseries for granularity='all'; demo deviates so the chart
  // has something to draw in the lifetime view.
  const ageDays = Math.max(1, spec.ageDays);
  const until = now;
  const since = now - ageDays * DAY;
  const start = Math.floor(since / DAY) * DAY;
  const buckets: number[] = [];
  for (let t = start; t < until; t += DAY) buckets.push(t);
  return { since, until, granularity: 'all', buckets, bucketMs: DAY };
}

// Smooth curve shaping: weight a bucket by combining a sinusoidal weekly
// pattern, a slow lifetime ramp, and a small jitter. Returns a positive
// multiplier ~[0.2 .. 1.6].
function bucketWeight(
  bucketStart: number,
  axis: WindowAxis,
  rng: ReturnType<typeof makeRng>,
): number {
  const dt = new Date(bucketStart);
  const dow = dt.getUTCDay();
  // Weekends ~25% heavier than midweek.
  const dowMul = dow === 0 || dow === 6 ? 1.25 : 1.0;
  // Diurnal: evenings (18..23 UTC) heavier than mornings.
  const hour = dt.getUTCHours();
  const hourMul = 0.6 + 0.4 * Math.sin(((hour - 8) * Math.PI) / 12);
  // Slow ramp across the window so newer buckets are a bit busier than
  // older ones · creates a visible "warming up" trend.
  const idx = (bucketStart - axis.buckets[0]!) / axis.bucketMs;
  const span = Math.max(1, axis.buckets.length - 1);
  const ramp = 0.7 + 0.6 * (idx / span);
  // Jitter so the chart isn't a perfect curve.
  const jitter = 0.6 + 0.8 * rng.next();
  return dowMul * hourMul * ramp * jitter;
}

function splitWeights(rng: ReturnType<typeof makeRng>, n: number, bias: number): number[] {
  // Generate n positive weights with a Zipf-ish drop-off so a few items
  // dominate. `bias` skews the head heavier (larger bias = sharper drop).
  if (n <= 0) return [];
  const exp = 0.9 + Math.max(0, bias);
  const raw: number[] = [];
  for (let i = 0; i < n; i++) {
    raw.push((1 / Math.pow(i + 1, exp)) * (0.85 + 0.3 * rng.next()));
  }
  const s = raw.reduce((a, b) => a + b, 0);
  return raw.map((r) => r / s);
}

function distribute(total: number, weights: readonly number[]): number[] {
  // Distribute `total` across len(weights) integer buckets, summing to total.
  const out = weights.map((w) => Math.floor(total * w));
  let remainder = total - out.reduce((a, b) => a + b, 0);
  let i = 0;
  while (remainder > 0) {
    out[i % out.length] = (out[i % out.length] ?? 0) + 1;
    remainder--;
    i++;
  }
  return out;
}

export function buildMeStats(spec: ScenarioSpec, win: FixtureWindow): MeStatsResponse {
  const rng = makeRng(spec.seed).fork(`stats:${win}`);
  const axis = buildWindowAxis(win, spec);

  // ─ Totals scaling ──────────────────────────────────────────────────
  // Scale fires/hits to the window length relative to ageDays.
  const windowDays = (axis.until - axis.since) / DAY;
  const lifetimeDays = Math.max(1, spec.ageDays);
  const winFraction = win === 'lifetime' ? 1 : Math.min(1, windowDays / lifetimeDays);
  const fires = Math.round(spec.firesTotal * winFraction);
  const hits = Math.round(fires * spec.hitRatio);
  // Mood derives from hits and the help/hurt bias. helpFrac in [0,1].
  const helpFrac = (spec.helpHurtBias + 1) / 2;
  const help_mood = Math.round(hits * helpFrac * 1.4);
  const hurt_mood = Math.round(hits * (1 - helpFrac) * 1.7);

  // Sessions scale the same way, with a floor of 1 if there were any fires.
  const sessions = fires > 0 ? Math.max(1, Math.round(spec.sessions * winFraction)) : 0;
  const play_ms = Math.round(sessions * (1000 * 60 * 9)); // ~9 min per session

  // ─ Bucket axis fires/hits ──────────────────────────────────────────
  const rawWeights = axis.buckets.map((b) => bucketWeight(b, axis, rng));
  const weightSum = rawWeights.reduce((a, b) => a + b, 0) || 1;
  const normWeights = rawWeights.map((w) => w / weightSum);
  const bucketFires = distribute(fires, normWeights);
  const bucketHits = bucketFires.map((f) => Math.round(f * spec.hitRatio));
  const bucketHelp = bucketHits.map((h) => Math.round(h * helpFrac * 1.4));
  const bucketHurt = bucketHits.map((h) => Math.round(h * (1 - helpFrac) * 1.7));

  const timeseries = axis.buckets.map((bucket_start, i) => ({
    bucket_start,
    fires: bucketFires[i] ?? 0,
    hits: bucketHits[i] ?? 0,
    help_mood: bucketHelp[i] ?? 0,
    hurt_mood: bucketHurt[i] ?? 0,
  }));

  // ─ Per-model ────────────────────────────────────────────────────────
  // Split lifetime fires across all personas. Favored personas get more
  // weight; the long tail gets a sliver each so the modal's "no activity"
  // path still renders for unfavored ones in lighter scenarios.
  const modelWeights: Record<ModelId, number> = {} as Record<ModelId, number>;
  for (const id of PERSONA_IDS) modelWeights[id as ModelId] = 0.05 + rng.next() * 0.05;
  spec.favoredModels.forEach((id, i) => {
    modelWeights[id] = 1.5 - i * 0.18;
  });
  const modelSum = Object.values(modelWeights).reduce((a, b) => a + b, 0) || 1;
  for (const id of PERSONA_IDS) modelWeights[id] = modelWeights[id]! / modelSum;

  const modelFires: Record<ModelId, number> = {} as Record<ModelId, number>;
  const modelHits: Record<ModelId, number> = {} as Record<ModelId, number>;
  const modelHelp: Record<ModelId, number> = {} as Record<ModelId, number>;
  const modelHurt: Record<ModelId, number> = {} as Record<ModelId, number>;
  for (const id of PERSONA_IDS) {
    modelFires[id] = Math.round(fires * modelWeights[id]);
    modelHits[id] = Math.round(modelFires[id] * spec.hitRatio);
    modelHelp[id] = Math.round(modelHits[id] * helpFrac * 1.4);
    modelHurt[id] = Math.round(modelHits[id] * (1 - helpFrac) * 1.7);
  }

  // ─ Per-verb ─────────────────────────────────────────────────────────
  // Pick a head of ~7 verbs and distribute fires Zipf-style; the rest get
  // zero so the Tools tab "Top tools" list is varied but not exhaustive.
  const verbHeadCount = fires > 0 ? Math.min(DEMO_VERBS.length, 7 + (rng.intBetween(0, 2))) : 0;
  const headIndices: number[] = [];
  const indices = [...Array(DEMO_VERBS.length).keys()];
  for (let i = 0; i < verbHeadCount && indices.length > 0; i++) {
    const idx = rng.intBetween(0, indices.length - 1);
    headIndices.push(indices.splice(idx, 1)[0]!);
  }
  const verbWeights = splitWeights(rng, verbHeadCount, 0.4);
  const verbFireCounts = distribute(fires, verbWeights);

  const per_verb: MeStatsResponse['per_verb'] = {};
  headIndices.forEach((verbIdx, i) => {
    const verb = DEMO_VERBS[verbIdx]!;
    const vFires = verbFireCounts[i] ?? 0;
    const vHits = Math.round(vFires * spec.hitRatio);
    // mood_delta direction depends on polarity. Approximation: punish-y
    // verbs (punch onward) skew negative, others positive.
    const negativeStart = DEMO_VERBS.indexOf('punch');
    const isNegative = verbIdx >= negativeStart && verb !== 'freeze' && verb !== 'grab';
    const sign = isNegative ? -1 : 1;
    const mood_delta_sum = sign * Math.round(vHits * (1.2 + rng.next() * 0.6));
    // Distribute hits across models proportional to model weights.
    const per_model: Record<ModelId, number> = {} as Record<ModelId, number>;
    for (const id of PERSONA_IDS) {
      per_model[id] = Math.round(vHits * modelWeights[id]);
    }
    per_verb[verb] = { fires: vFires, hits: vHits, mood_delta_sum, per_model };
  });

  // ─ Per-model favorite_verb + state_firsts ──────────────────────────
  const moodStates: MoodState[] = ['ECSTATIC', 'HAPPY', 'CONTENT', 'WORRIED', 'HURT', 'BROKEN'];
  const per_model: MeStatsResponse['per_model'] = {} as MeStatsResponse['per_model'];
  for (const id of PERSONA_IDS) {
    // Favorite verb · the verb with the most hits against this model.
    let favVerb: string | null = null;
    let bestHits = 0;
    for (const [verb, v] of Object.entries(per_verb)) {
      const h = v.per_model[id] ?? 0;
      if (h > bestHits) {
        bestHits = h;
        favVerb = verb;
      }
    }
    const state_firsts: MoodState[] = [];
    const nFirsts = modelFires[id] > 50 ? rng.intBetween(2, 5) : modelFires[id] > 0 ? rng.intBetween(0, 2) : 0;
    for (let i = 0; i < nFirsts; i++) {
      const ms = moodStates[rng.intBetween(0, moodStates.length - 1)]!;
      if (!state_firsts.includes(ms)) state_firsts.push(ms);
    }
    per_model[id] = {
      fires: modelFires[id]!,
      hits: modelHits[id]!,
      help_mood: modelHelp[id]!,
      hurt_mood: modelHurt[id]!,
      favorite_verb: favVerb,
      state_firsts,
    };
  }

  // ─ Per-model timeseries ────────────────────────────────────────────
  const per_model_timeseries: NonNullable<MeStatsResponse['per_model_timeseries']> = [];
  for (let bi = 0; bi < axis.buckets.length; bi++) {
    const bucket_start = axis.buckets[bi]!;
    const totalF = bucketFires[bi] ?? 0;
    if (totalF === 0) continue;
    for (const id of PERSONA_IDS) {
      const f = Math.round(totalF * modelWeights[id]);
      if (f === 0) continue;
      const h = Math.round(f * spec.hitRatio);
      per_model_timeseries.push({
        bucket_start,
        model: id,
        fires: f,
        hits: h,
        help_mood: Math.round(h * helpFrac * 1.4),
        hurt_mood: Math.round(h * (1 - helpFrac) * 1.7),
      });
    }
  }

  // ─ Per-verb timeseries ─────────────────────────────────────────────
  const per_verb_timeseries: NonNullable<MeStatsResponse['per_verb_timeseries']> = [];
  for (let bi = 0; bi < axis.buckets.length; bi++) {
    const bucket_start = axis.buckets[bi]!;
    const totalF = bucketFires[bi] ?? 0;
    if (totalF === 0) continue;
    headIndices.forEach((verbIdx, vi) => {
      const verb = DEMO_VERBS[verbIdx]!;
      const w = verbWeights[vi] ?? 0;
      const f = Math.round(totalF * w);
      if (f === 0) return;
      const h = Math.round(f * spec.hitRatio);
      const negativeStart = DEMO_VERBS.indexOf('punch');
      const isNegative = verbIdx >= negativeStart && verb !== 'freeze' && verb !== 'grab';
      const md = (isNegative ? -1 : 1) * Math.round(h * 1.4);
      per_verb_timeseries.push({ bucket_start, verb, fires: f, hits: h, mood_delta: md });
    });
  }

  // ─ Hit heatmap (per part per character) ────────────────────────────
  const parts: PartType[] = ['head', 'torso', 'arm', 'leg'];
  const hit_heatmap: NonNullable<MeStatsResponse['hit_heatmap']> = [];
  for (const id of PERSONA_IDS) {
    const total = modelHits[id] ?? 0;
    if (total === 0) continue;
    // Heads + torso land more often than limbs.
    const partWeights = [0.35, 0.32, 0.17, 0.16];
    const counts = distribute(total, partWeights);
    parts.forEach((part, i) => {
      const count = counts[i] ?? 0;
      if (count > 0) hit_heatmap.push({ character: id, part, count });
    });
  }

  // ─ Time of day heatmap ─────────────────────────────────────────────
  const time_of_day_heatmap: NonNullable<MeStatsResponse['time_of_day_heatmap']> = [];
  if (fires > 0) {
    for (let dow = 0; dow < 7; dow++) {
      const dowMul = dow === 0 || dow === 6 ? 1.4 : 1.0;
      for (let hour = 0; hour < 24; hour++) {
        // Evening peak ~20:00. Quiet 02:00–06:00.
        const peak = 1 - Math.abs(hour - 20) / 14;
        const base = Math.max(0, peak) * dowMul;
        const jitter = 0.6 + 0.8 * rng.next();
        const f = Math.round((fires / (7 * 24)) * base * jitter * 3);
        if (f > 0) {
          time_of_day_heatmap.push({
            dow,
            hour,
            fires: f,
            hits: Math.round(f * spec.hitRatio),
          });
        }
      }
    }
  }

  // ─ Daily calendar ──────────────────────────────────────────────────
  // Always populate 365 days back so the calendar heatmap fills out;
  // recent N days follow the streak shape, older days have sparse jitter.
  const daily_calendar: NonNullable<MeStatsResponse['daily_calendar']> = [];
  if (fires > 0) {
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    for (let d = 364; d >= 0; d--) {
      const ts = today.getTime() - d * DAY;
      const date = new Date(ts).toISOString().slice(0, 10);
      const withinAge = d < lifetimeDays;
      const withinCurrentStreak = d < spec.currentStreakDays;
      // Recent streak: every day active. Older days within ageDays: prob 0.4.
      // Past ageDays: prob 0.05 (occasional speckle so the calendar isn't a
      // hard cliff).
      const p = withinCurrentStreak ? 1 : withinAge ? 0.42 : 0.04;
      if (rng.chance(p)) {
        const f = rng.intBetween(5, 80);
        daily_calendar.push({
          date,
          fires: f,
          hits: Math.round(f * spec.hitRatio),
          sessions: rng.intBetween(1, 4),
          play_ms: f * 1200,
        });
      }
    }
  }

  // ─ Session summaries ───────────────────────────────────────────────
  const session_summaries: NonNullable<MeStatsResponse['session_summaries']> = [];
  for (let i = 0; i < sessions; i++) {
    const started_at = axis.since + rng.next() * Math.max(1, axis.until - axis.since);
    const duration_ms = rng.intBetween(60_000, 1_400_000);
    const character: ModelId | null = spec.favoredModels.length > 0
      ? spec.favoredModels[rng.intBetween(0, spec.favoredModels.length - 1)] ?? null
      : (PERSONA_IDS[rng.intBetween(0, PERSONA_IDS.length - 1)] as ModelId | undefined) ?? null;
    const sf = rng.intBetween(8, 80);
    const sh = Math.round(sf * spec.hitRatio);
    const end_state = moodStates[rng.intBetween(0, moodStates.length - 1)] ?? null;
    session_summaries.push({
      session_id: `sess-${i}-${spec.seed.toString(16)}`,
      started_at,
      ended_at: started_at + duration_ms,
      duration_ms,
      character,
      fires: sf,
      hits: sh,
      help_mood: Math.round(sh * helpFrac * 1.4),
      hurt_mood: Math.round(sh * (1 - helpFrac) * 1.7),
      peak_mood: rng.intBetween(20, 100),
      trough_mood: -rng.intBetween(0, 100),
      end_state,
      longest_combo: rng.intBetween(2, Math.max(2, spec.longestCombo)),
    });
  }

  // ─ Combo log ───────────────────────────────────────────────────────
  const combo_log: NonNullable<MeStatsResponse['combo_log']> = [];
  const comboCount = fires > 0 ? Math.min(6, Math.max(2, Math.round(sessions / 4))) : 0;
  for (let i = 0; i < comboCount; i++) {
    const character: ModelId = spec.favoredModels.length > 0
      ? spec.favoredModels[rng.intBetween(0, spec.favoredModels.length - 1)]!
      : (PERSONA_IDS[rng.intBetween(0, PERSONA_IDS.length - 1)] as ModelId);
    const len = rng.intBetween(3, Math.max(3, Math.min(spec.longestCombo, 18)));
    const verbs: string[] = [];
    for (let k = 0; k < len; k++) {
      verbs.push(headIndices.length > 0
        ? DEMO_VERBS[headIndices[rng.intBetween(0, headIndices.length - 1)]!]!
        : DEMO_VERBS[rng.intBetween(0, DEMO_VERBS.length - 1)]!);
    }
    const negativeStart = DEMO_VERBS.indexOf('punch');
    const isNegative = verbs.some((v) => {
      const idx = DEMO_VERBS.indexOf(v as (typeof DEMO_VERBS)[number]);
      return idx >= negativeStart && v !== 'freeze' && v !== 'grab';
    });
    combo_log.push({
      ts: axis.since + rng.next() * Math.max(1, axis.until - axis.since),
      character,
      verbs,
      duration_ms: rng.intBetween(2_000, 18_000),
      total_mood_delta: (isNegative ? -1 : 1) * rng.intBetween(20, 200),
    });
  }

  // ─ Records ─────────────────────────────────────────────────────────
  const records = {
    longest_combo: spec.longestCombo,
    biggest_session_hurt: fires > 0 ? Math.round(hurt_mood / Math.max(1, sessions)) * 3 : 0,
    biggest_session_help: fires > 0 ? Math.round(help_mood / Math.max(1, sessions)) * 3 : 0,
    longest_session_ms: fires > 0 ? rng.intBetween(15 * 60_000, 90 * 60_000) : 0,
  };

  const response = {
    user_id: `demo-${spec.seed.toString(16)}`,
    window: {
      since: new Date(axis.since).toISOString(),
      until: new Date(axis.until).toISOString(),
      granularity: axis.granularity,
    },
    totals: {
      sessions,
      fires,
      hits,
      help_mood,
      hurt_mood,
      play_ms,
    },
    per_model,
    per_verb,
    timeseries,
    records,
    hit_heatmap,
    combo_log,
    per_verb_timeseries,
    per_model_timeseries,
    time_of_day_heatmap,
    daily_calendar,
    session_summaries,
  } satisfies MeStatsResponse;

  return response;
}
