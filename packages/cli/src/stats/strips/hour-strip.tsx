// 24 hour-cells in chronological order (oldest left, newest right). Hour
// labels float above every 6th cell showing the actual clock-hour of
// that bucket so the strip stays honest to "last 24 hours" not "today
// since midnight" · the window is a sliding window, not a calendar day.
//
// Empty windows still render the full 24-cell chassis (all idle cells)
// rather than a "no data" message · the layout's shape is information
// in itself, and seeing the dimmed strip is clearer than seeing nothing.

import { Box, Text } from 'ink';
import type { MeStatsResponse } from '../../../../shared/src/events.js';
import { DEFAULT_PALETTE, intensityCell } from '../heatmap.js';
import { IntensityLegend } from '../layout/intensity-legend.js';

export function HourStrip({ data }: { data: MeStatsResponse }) {
  const ts = [...(data.timeseries ?? [])].sort(
    (a, b) => a.bucket_start - b.bucket_start,
  );
  const cellWidth = 2;
  const empty = ts.length === 0;

  // Synthesize 24 buckets aligned to the current clock when empty so the
  // hour-of-day labels still read correctly. Real data takes precedence.
  const sampled = empty
    ? Array.from({ length: 24 }, (_, i) => ({
        bucket_start: Date.now() - (23 - i) * 3_600_000,
        fires: 0,
        hits: 0,
      }))
    : ts;

  const values = sampled.map((t) => (t.fires ?? 0) + (t.hits ?? 0));
  const max = Math.max(1, ...values);
  const cells = values.map((v) => intensityCell(v, max, DEFAULT_PALETTE));
  const totalWidth = cells.length * cellWidth;

  // Build the hour-label strip · one 2-char hour label every 6 buckets.
  const labelRow = new Array(totalWidth).fill(' ');
  for (let i = 0; i < sampled.length; i += 6) {
    const hr = new Date(sampled[i]!.bucket_start)
      .getHours()
      .toString()
      .padStart(2, '0');
    const col = i * cellWidth;
    if (col + 2 <= totalWidth) {
      labelRow[col] = hr[0]!;
      labelRow[col + 1] = hr[1]!;
    }
  }

  return (
    <Box flexDirection="column">
      <Text bold>Last 24 hours</Text>
      <Box marginTop={1} flexDirection="column">
        <Text color="gray">{labelRow.join('')}</Text>
        <Text>
          {cells.map((c, i) => (
            <Text key={i} color={c.color}>
              {c.ch.repeat(cellWidth)}
            </Text>
          ))}
        </Text>
        <IntensityLegend />
      </Box>
    </Box>
  );
}
