// Reshape a LeaderboardResponse (aggregated across all users) into the
// MeStatsResponse envelope so the same renderers consume both. Fields
// that have no global equivalent (records, daily_calendar, sessions,
// time-of-day heatmap, hit_heatmap, combo_log) come back EMPTY · the
// rendering surface treats those panes as "no data" rather than
// inventing values that don't exist at the global level.
//
// Why reshape instead of branching the UI:
//   The TUI and web both already render rich panels around the
//   MeStatsResponse shape. Building parallel global-only panels would
//   double the surface area; the global view's natural strengths
//   (per-persona help/hurt totals, leaderboard timeseries) are
//   answered well by the existing Models tab once the data is in the
//   familiar shape. The lossy projection is the right tradeoff,
//   "global mode" is fundamentally about cross-user aggregates, not
//   personal records.

import type {
  LeaderboardResponse,
  MeStatsResponse,
  VerbId,
} from '../events.js';
import { PERSONA_IDS, type ModelId } from '../personas.js';

// ─ /leaderboard/series wire types (Stage 2 global-benchmark overlay) ───
// The series endpoint returns per-day help/hurt counts per model so the
// frontend can overlay a faint "global benchmark" curve on the personal
// trend chart. Sparse: days with no activity are absent from the array;
// per_model entries are absent for models that had no activity on a
// given day. Frontend handles gap-filling and the "empty per_model"
// case.

export interface LeaderboardSeriesDayPerModel {
  help: number;
  hurt: number;
}

export interface LeaderboardSeriesDay {
  date: string;          // YYYY-MM-DD UTC
  per_model: Partial<Record<ModelId, LeaderboardSeriesDayPerModel>>;
}

export interface LeaderboardSeriesResponse {
  timeseries: LeaderboardSeriesDay[];
}

// Synthetic user_id used in the reshaped envelope to make it obvious in
// logs that the data isn't tied to a real user. Format mirrors the
// "demo-<scenario>" convention so renderers that case on user_id
// prefix don't need a second branch.
export const GLOBAL_USER_ID = 'global-aggregate';

export function leaderboardToStatsEnvelope(
  lb: LeaderboardResponse,
): MeStatsResponse {
  // ─ Totals ───────────────────────────────────────────────────────────
  // Help/hurt counts at the persona level become global totals when
  // summed. Sessions sum across personas (worker tracks per-persona
  // session counts, not a global unique-session count). Play_ms and
  // unique-users have no clean equivalent in MeStats so we zero them.
  let totalFires = 0;
  let totalHits = 0;
  let totalHelp = 0;
  let totalHurt = 0;
  let totalSessions = 0;
  for (const id of PERSONA_IDS) {
    const p = lb.per_model[id as ModelId];
    if (!p) continue;
    totalHelp += p.help_count;
    totalHurt += p.hurt_count;
    totalFires += p.help_count + p.hurt_count;
    totalHits += p.help_count + p.hurt_count;
    totalSessions += p.sessions;
  }

  // ─ Per-model ────────────────────────────────────────────────────────
  const per_model: MeStatsResponse['per_model'] = {} as MeStatsResponse['per_model'];
  for (const id of PERSONA_IDS) {
    const p = lb.per_model[id as ModelId];
    const help = p?.help_count ?? 0;
    const hurt = p?.hurt_count ?? 0;
    per_model[id as ModelId] = {
      fires: help + hurt,
      hits: help + hurt,
      help_mood: help,
      hurt_mood: hurt,
      favorite_verb: pickMostUsedAgainst(lb, id as ModelId),
      state_firsts: [], // per-user concept; empty in global
    };
  }

  // ─ Per-verb ─────────────────────────────────────────────────────────
  // per_verb_meta carries global fires plus the most-used-against
  // persona for each verb. We project fires → fires/hits and synth a
  // per_model breakdown by attributing all of a verb's fires to its
  // most-used-against persona. This is approximate, but it gives the
  // Tools tab a coherent "who got hit by this verb" answer at the
  // global scale without inventing a multi-persona attribution.
  const per_verb: MeStatsResponse['per_verb'] = {};
  for (const [verb, meta] of Object.entries(lb.per_verb_meta)) {
    const v = verb as VerbId;
    const target = meta.most_used_against;
    const per_model_breakdown: Record<ModelId, number> = {} as Record<ModelId, number>;
    for (const id of PERSONA_IDS) {
      per_model_breakdown[id as ModelId] = target === id ? meta.fires : 0;
    }
    per_verb[v] = {
      fires: meta.fires,
      hits: meta.fires,
      mood_delta_sum: 0, // not carried in leaderboard
      per_model: per_model_breakdown,
    };
  }

  // ─ Timeseries ──────────────────────────────────────────────────────
  // Sum help+hurt per bucket for the totals timeseries; project per
  // model into per_model_timeseries (no separate hits/help_mood/
  // hurt_mood distinction available · we treat help_count as both
  // hits AND help_mood, hurt_count as both hits AND hurt_mood).
  const timeseries: MeStatsResponse['timeseries'] = lb.timeseries.map((row) => {
    let bucketHelp = 0;
    let bucketHurt = 0;
    for (const id of PERSONA_IDS) {
      const cell = row.per_model[id as ModelId];
      if (!cell) continue;
      bucketHelp += cell.help;
      bucketHurt += cell.hurt;
    }
    return {
      bucket_start: row.bucket_start,
      fires: bucketHelp + bucketHurt,
      hits: bucketHelp + bucketHurt,
      help_mood: bucketHelp,
      hurt_mood: bucketHurt,
    };
  });

  const per_model_timeseries: NonNullable<MeStatsResponse['per_model_timeseries']> = [];
  for (const row of lb.timeseries) {
    for (const id of PERSONA_IDS) {
      const cell = row.per_model[id as ModelId];
      if (!cell) continue;
      const fires = cell.help + cell.hurt;
      if (fires === 0) continue;
      per_model_timeseries.push({
        bucket_start: row.bucket_start,
        model: id as ModelId,
        fires,
        hits: fires,
        help_mood: cell.help,
        hurt_mood: cell.hurt,
      });
    }
  }

  // Per_verb_timeseries has no leaderboard equivalent · global verb
  // breakdowns aren't bucketed. Leave empty; the Tools tab's verb-
  // sparklines column degrades gracefully (no row sparklines, just
  // totals).
  const per_verb_timeseries: NonNullable<MeStatsResponse['per_verb_timeseries']> = [];

  // ─ Records · empty ─────────────────────────────────────────────────
  // Personal achievements (longest combo, biggest help/hurt session,
  // longest session) don't translate to a global aggregate. Zeros are
  // honest; the Overview pane already renders gracefully on empties.
  const records: MeStatsResponse['records'] = {
    longest_combo: 0,
    biggest_session_hurt: 0,
    biggest_session_help: 0,
    longest_session_ms: 0,
  };

  return {
    user_id: GLOBAL_USER_ID,
    window: lb.window,
    totals: {
      sessions: totalSessions,
      fires: totalFires,
      hits: totalHits,
      help_mood: totalHelp,
      hurt_mood: totalHurt,
      play_ms: 0,
    },
    per_model,
    per_verb,
    timeseries,
    records,
    // The following optional fields have no leaderboard equivalent.
    // Leave undefined / empty so renderers skip them cleanly.
    hit_heatmap: [],
    combo_log: [],
    per_verb_timeseries,
    per_model_timeseries,
    time_of_day_heatmap: [],
    daily_calendar: [],
    session_summaries: [],
  };
}

function pickMostUsedAgainst(
  lb: LeaderboardResponse,
  modelId: ModelId,
): VerbId | null {
  // The verb most often used against this persona, globally · find
  // the verb whose `most_used_against === modelId` with the highest
  // `fires` count. Returns null if no verb singles this persona out.
  let best: { verb: VerbId; fires: number } | null = null;
  for (const [verb, meta] of Object.entries(lb.per_verb_meta)) {
    if (meta.most_used_against !== modelId) continue;
    if (!best || meta.fires > best.fires) {
      best = { verb: verb as VerbId, fires: meta.fires };
    }
  }
  return best?.verb ?? null;
}
