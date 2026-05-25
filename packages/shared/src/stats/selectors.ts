// Pure selectors that pull a single answer ("favorite verb", "top
// persona", "most active day") out of a MeStatsResponse. No rendering,
// no formatting · the caller decides how to present.

import type { MeStatsResponse, MoodState, VerbId } from '../events.js';
import { PERSONA_IDS, type ModelId } from '../personas.js';

// Persona ids ranked by fires desc. Stable order for ties (PERSONA_IDS
// order). Used as the "natural reading order" for any table or focus-
// cycle UI element.
export function rankPersonaIds(data: MeStatsResponse): ModelId[] {
  return [...PERSONA_IDS]
    .map((id) => ({
      id: id as ModelId,
      fires: data.per_model[id as ModelId]?.fires ?? 0,
    }))
    .sort((a, b) => b.fires - a.fires)
    .map((r) => r.id);
}

// Persona with the most fires in window, or null if every persona is
// inactive. Use this for "your favorite is X" copy; for ranked lists
// prefer rankPersonaIds().
export function pickFavoriteModel(data: MeStatsResponse): ModelId | null {
  let best: { id: ModelId; fires: number } | null = null;
  for (const id of PERSONA_IDS) {
    const fires = data.per_model[id as ModelId]?.fires ?? 0;
    if (fires > 0 && (!best || fires > best.fires)) {
      best = { id: id as ModelId, fires };
    }
  }
  return best?.id ?? null;
}

// Verb with the most fires in window, or null if there were no fires.
// Returned as a raw verb id (string) since VerbId is just a string in
// the wire shape · the caller maps to a label.
export function pickFavoriteVerb(data: MeStatsResponse): VerbId | null {
  let best: { verb: VerbId; fires: number } | null = null;
  for (const [verb, v] of Object.entries(data.per_verb ?? {})) {
    const fires = v.fires ?? 0;
    if (fires > 0 && (!best || fires > best.fires)) {
      best = { verb, fires };
    }
  }
  return best?.verb ?? null;
}

// daily_calendar entry with the most (fires + hits), or null. Returns
// the whole entry so callers can format the date how they like.
export function pickMostActiveDay(
  data: MeStatsResponse,
): MeStatsResponse['daily_calendar'] extends infer T
  ? T extends ReadonlyArray<infer E>
    ? E | null
    : null
  : null {
  let best: NonNullable<MeStatsResponse['daily_calendar']>[number] | null = null;
  let bestV = 0;
  for (const d of data.daily_calendar ?? []) {
    const v = (d.fires ?? 0) + (d.hits ?? 0);
    if (v > 0 && v > bestV) {
      best = d;
      bestV = v;
    }
  }
  // Type assertion needed because the conditional return type the API
  // exposes is a derived form for ergonomic call sites.
  return best as never;
}

// Total fires across personas. Useful for share calculations.
export function totalFires(data: MeStatsResponse): number {
  return PERSONA_IDS.reduce(
    (sum, id) => sum + (data.per_model[id as ModelId]?.fires ?? 0),
    0,
  );
}

// All mood states a persona has reached, in encounter order. Mirrors the
// state_firsts contract on per_model; surfaced as a typed array.
export function moodStatesReached(
  data: MeStatsResponse,
  modelId: ModelId,
): MoodState[] {
  return data.per_model[modelId]?.state_firsts ?? [];
}
