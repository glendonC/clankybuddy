// Axis-label helpers · turn bucket boundaries and window choices into
// human-readable strip labels. Lives here so the strip components and
// the chart consumer share one source.

import type { MeStatsResponse } from '../../../shared/src/events.js';
import { fmtShortDate } from '../../../shared/src/stats/index.js';
import type { StatsWindow } from '../me-stats.js';

// Three labels (or fewer) for the x-axis · first / mid / last bucket
// in the totals timeseries. Use the totals row as the alignment source
// of truth so per-model and per-verb charts read off the same x.
export function buildXAxisLabels(data: MeStatsResponse): string[] {
  const ts = data.timeseries ?? [];
  if (ts.length === 0) return [''];
  const first = ts[0]!.bucket_start;
  const last = ts[ts.length - 1]!.bucket_start;
  if (ts.length === 1) return [fmtShortDate(first)];
  if (ts.length === 2) return [fmtShortDate(first), fmtShortDate(last)];
  const mid = ts[Math.floor(ts.length / 2)]!.bucket_start;
  return [fmtShortDate(first), fmtShortDate(mid), fmtShortDate(last)];
}

// Y-axis quantity label · explicit "fires per <bucket>" so the user
// knows what the numbered ticks mean. The Models chart used to be
// titled "Activity over time" with no unit hint, which left the y-axis
// numbers ambiguous · fires? hits? combo length?
export function yAxisQuantityForWindow(win: StatsWindow): string {
  if (win === 'day') return 'Fires per hour';
  if (win === 'week') return 'Fires per day';
  return 'Fires per day';
}

// Hour-of-day ribbon · "00..06..12..18.." labels placed at the
// matching column indices in a strip of width `hours`. Used by the
// Tools tab's time-of-day heatmap and the Overview's HourStrip.
export function buildHourAxisLabel(hours: number): string {
  const points = [0, 6, 12, 18, hours].filter((h, i, arr) => arr.indexOf(h) === i);
  const out: string[] = new Array(hours).fill(' ');
  for (const h of points) {
    if (h >= hours) continue;
    const s = h.toString().padStart(2, '0');
    if (h + s.length <= hours) {
      for (let i = 0; i < s.length; i++) out[h + i] = s[i]!;
    }
  }
  return out.join('');
}
