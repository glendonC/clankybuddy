// Build a LeaderboardResponse fixture from a ScenarioSpec. Scaled up
// from the personal data, the "global" view should feel like the
// internet, not like one user. We multiply the per-user envelope by a
// crowd factor and add unique-users counts that aren't a function of
// the spec's personal activity envelope.

import type { LeaderboardResponse, VerbId } from '../../events.js';
import { PERSONA_IDS, type ModelId } from '../../personas.js';
import { makeRng } from './rng.js';
import type { ScenarioSpec } from './scenarios.js';
import type { FixtureWindow } from './me-stats.js';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

// Tunes the absolute scale of the global crowd. heavyUser scenario at
// CROWD_FACTOR=1200 produces ~5M fires lifetime · enough zeros to feel
// like a global tally without looking absurd.
const CROWD_FACTOR = 1200;

const DEMO_VERBS_GLOBAL = [
  'pet', 'compliment', 'feed', 'gift', 'gpu',
  'punch', 'hammer', 'lightsaber', 'shotgun', 'rocket',
  'grenade', 'fireball', 'flamethrower', 'lightning',
  'anvil', 'blackhole', 'nuke', 'freeze',
] as const;

function buildAxis(win: FixtureWindow, spec: ScenarioSpec) {
  const now = Date.now();
  if (win === 'day') {
    const until = now;
    const since = now - 24 * HOUR;
    const start = Math.floor(since / HOUR) * HOUR;
    const buckets: number[] = [];
    for (let t = start; t < until; t += HOUR) buckets.push(t);
    return { since, until, granularity: 'hour' as const, buckets };
  }
  if (win === 'week') {
    const until = now;
    const since = now - 7 * DAY;
    const start = Math.floor(since / DAY) * DAY;
    const buckets: number[] = [];
    for (let t = start; t < until; t += DAY) buckets.push(t);
    return { since, until, granularity: 'day' as const, buckets };
  }
  const ageDays = Math.max(7, spec.ageDays || 30);
  const until = now;
  const since = now - ageDays * DAY;
  const start = Math.floor(since / DAY) * DAY;
  const buckets: number[] = [];
  for (let t = start; t < until; t += DAY) buckets.push(t);
  return { since, until, granularity: 'all' as const, buckets };
}

export function buildLeaderboard(
  spec: ScenarioSpec,
  win: FixtureWindow,
): LeaderboardResponse {
  const rng = makeRng(spec.seed).fork(`lb:${win}`);
  const axis = buildAxis(win, spec);

  // Per-persona crowd shape · invert the user's bias so the global
  // crowd shows different favorites than the user. Then weight each
  // persona by an organic share that totals ~1.
  const personaWeights: Record<ModelId, number> = {} as Record<ModelId, number>;
  // Anchor weights so the same scenario yields stable global shares.
  const anchor: Record<ModelId, number> = {
    claude: 0.22,
    gpt: 0.28,
    gemini: 0.16,
    grok: 0.08,
    llama: 0.14,
    deepseek: 0.12,
  };
  let sum = 0;
  for (const id of PERSONA_IDS) {
    // Jitter ±15% per persona, deterministic via RNG.
    const w = anchor[id as ModelId] * (0.85 + 0.3 * rng.next());
    personaWeights[id as ModelId] = w;
    sum += w;
  }
  for (const id of PERSONA_IDS) personaWeights[id as ModelId] /= sum;

  // Total interactions across the window. Scales by window length so
  // 24h is ~1/30th of lifetime in the heavyUser scenario.
  const winDays = (axis.until - axis.since) / DAY;
  const lifetimeDays = Math.max(7, spec.ageDays || 30);
  const winFraction = win === 'lifetime' ? 1 : Math.min(1, winDays / lifetimeDays);
  const globalFires = Math.round(
    Math.max(1000, (spec.firesTotal || 1000) * CROWD_FACTOR * winFraction),
  );

  // Per-persona help/hurt with a help-hurt bias tied (but not pinned)
  // to the spec, the crowd is more help-leaning than any one user.
  const globalHelpFrac = Math.min(0.7, Math.max(0.3, (spec.helpHurtBias + 1) / 2 * 0.6 + 0.3));

  const per_model: LeaderboardResponse['per_model'] = {} as LeaderboardResponse['per_model'];
  for (const id of PERSONA_IDS) {
    const share = personaWeights[id as ModelId];
    const personaFires = Math.round(globalFires * share);
    // Each persona has a slightly different help/hurt mix · jittered.
    const personaHelpFrac = Math.min(
      0.85,
      Math.max(0.15, globalHelpFrac + (rng.next() - 0.5) * 0.25),
    );
    const help_count = Math.round(personaFires * personaHelpFrac);
    const hurt_count = personaFires - help_count;
    // Sessions ≈ 1 session per ~80 fires globally · jittered.
    const sessions = Math.max(0, Math.round(personaFires / 80));
    // Unique users · derived from share, with a floor so even quiet
    // personas show >0 contributors.
    const unique_users = Math.max(1, Math.round(personaFires / 35));
    per_model[id as ModelId] = { help_count, hurt_count, sessions, unique_users };
  }

  // Per-verb meta · head of 12 verbs distributed Zipf-style.
  const per_verb_meta: LeaderboardResponse['per_verb_meta'] = {};
  const verbHead = [...DEMO_VERBS_GLOBAL].slice(0, 12);
  let verbWeightSum = 0;
  const verbWeights = verbHead.map((_, i) => {
    const w = (1 / Math.pow(i + 1, 0.95)) * (0.85 + 0.3 * rng.next());
    verbWeightSum += w;
    return w;
  });
  verbHead.forEach((verb, i) => {
    const w = verbWeights[i]! / verbWeightSum;
    const fires = Math.round(globalFires * w * 0.4); // verb fires are a subset
    // Most-used-against · weighted pick by personaWeights, biased
    // toward heavier-share personas.
    const ids = [...PERSONA_IDS];
    const ws = ids.map((id) => personaWeights[id as ModelId]);
    const target = rng.weightedPick(ids, ws);
    per_verb_meta[verb as VerbId] = {
      fires,
      most_used_against: target as ModelId,
    };
  });

  // Timeseries · for each bucket, allocate a share of globalFires and
  // split it per persona using personaWeights ± jitter.
  const bucketWeights = axis.buckets.map((bs) => {
    // Weekend boost + diurnal curve so the chart has rhythm.
    const dt = new Date(bs);
    const dow = dt.getUTCDay();
    const dowMul = dow === 0 || dow === 6 ? 1.25 : 1;
    const hour = dt.getUTCHours();
    const hourMul = 0.6 + 0.4 * Math.sin(((hour - 8) * Math.PI) / 12);
    return dowMul * hourMul * (0.7 + 0.6 * rng.next());
  });
  const bwSum = bucketWeights.reduce((a, b) => a + b, 0) || 1;
  const timeseries: LeaderboardResponse['timeseries'] = axis.buckets.map(
    (bucket_start, bi) => {
      const bucketTotal = Math.round(globalFires * (bucketWeights[bi]! / bwSum));
      const per_model_cell: Record<ModelId, { help: number; hurt: number }> =
        {} as Record<ModelId, { help: number; hurt: number }>;
      for (const id of PERSONA_IDS) {
        const personaCell = per_model[id as ModelId];
        if (!personaCell) continue;
        // Allocate this persona's share of THIS bucket. Approx the
        // persona's overall share of fires, applied to the bucket.
        const f = Math.round(bucketTotal * personaWeights[id as ModelId]);
        const totalForPersona = personaCell.help_count + personaCell.hurt_count;
        const helpFrac = totalForPersona > 0
          ? personaCell.help_count / totalForPersona
          : 0.5;
        const help = Math.round(f * helpFrac);
        const hurt = f - help;
        per_model_cell[id as ModelId] = { help, hurt };
      }
      return { bucket_start, per_model: per_model_cell };
    },
  );

  return {
    window: {
      since: new Date(axis.since).toISOString(),
      until: new Date(axis.until).toISOString(),
      granularity: axis.granularity,
    },
    per_model,
    per_verb_meta,
    timeseries,
  };
}
