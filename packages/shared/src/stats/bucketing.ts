// Bucket-axis helpers · the timeseries fields on MeStatsResponse are
// sparse (rows omitted where activity was zero). Most renderers need a
// DENSE aligned axis instead: one value per bucket along a single x-axis
// shared across personas and verbs. These helpers do that alignment in
// one place so the TUI and web don't each ship their own version.

import type { MeStatsResponse, VerbId } from '../events.js';
import { PERSONA_IDS, type ModelId } from '../personas.js';

// The canonical x-axis · bucket_start values sorted ascending. Built
// from data.timeseries (the totals row, which is the union of all
// activity buckets) so per-model and per-verb projections share the
// same length and time alignment as the headline chart.
export function bucketAxis(data: MeStatsResponse): number[] {
  return (data.timeseries ?? [])
    .map((t) => t.bucket_start)
    .sort((a, b) => a - b);
}

// Per-model fires aligned to the bucketAxis. Zero where the model had
// no activity in that bucket (vs `null` which would break chart lines).
// Use this directly as a sparkline input or as a Series.values entry
// after mapping zero → null for step-chart gaps.
export function perModelBuckets(
  data: MeStatsResponse,
  modelId: ModelId,
  field: 'fires' | 'hits' | 'help_mood' | 'hurt_mood' = 'fires',
): number[] {
  const axis = bucketAxis(data);
  const idxByStart = new Map<number, number>();
  axis.forEach((b, i) => idxByStart.set(b, i));
  const out = new Array(axis.length).fill(0);
  for (const row of data.per_model_timeseries ?? []) {
    if (row.model !== modelId) continue;
    const i = idxByStart.get(row.bucket_start);
    if (i == null) continue;
    out[i] += row[field] ?? 0;
  }
  return out;
}

// Per-verb fires aligned to the bucketAxis. Same contract as
// perModelBuckets but indexed by verb id.
export function perVerbBuckets(
  data: MeStatsResponse,
  verb: VerbId,
  field: 'fires' | 'hits' | 'mood_delta' = 'fires',
): number[] {
  const axis = bucketAxis(data);
  const idxByStart = new Map<number, number>();
  axis.forEach((b, i) => idxByStart.set(b, i));
  const out = new Array(axis.length).fill(0);
  for (const row of data.per_verb_timeseries ?? []) {
    if (row.verb !== verb) continue;
    const i = idxByStart.get(row.bucket_start);
    if (i == null) continue;
    out[i] += row[field] ?? 0;
  }
  return out;
}

// Help and hurt mood split per bucket. Two parallel dense arrays. Used
// by pulse-style charts that draw the two polarities as opposing areas.
export function helpHurtBuckets(
  data: MeStatsResponse,
): { help: number[]; hurt: number[] } {
  const ts = data.timeseries ?? [];
  return {
    help: ts.map((t) => t.help_mood ?? 0),
    hurt: ts.map((t) => t.hurt_mood ?? 0),
  };
}

// Convenience: all personas at once, aligned to the same axis. Returns a
// map keyed by ModelId. Skips personas with zero total activity so
// callers that want to filter by "did this persona appear in this
// window" can do so without re-checking the totals.
export function allPerModelBuckets(
  data: MeStatsResponse,
  field: 'fires' | 'hits' | 'help_mood' | 'hurt_mood' = 'fires',
): Map<ModelId, number[]> {
  const out = new Map<ModelId, number[]>();
  for (const id of PERSONA_IDS) {
    const vals = perModelBuckets(data, id as ModelId, field);
    if (vals.some((v) => v > 0)) out.set(id as ModelId, vals);
  }
  return out;
}
