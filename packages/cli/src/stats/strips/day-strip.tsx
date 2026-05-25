// 7 day-cells, today rightmost. Day-of-week labels float above each cell.
// 3-char cells with a 1-char gap so labels and cells share alignment.
// Empty windows still render the full 7-cell chassis (idle cells) so the
// modal's shape stays consistent · the user sees "where the data would
// have been" instead of a missing-content gap.

import { Box, Text } from 'ink';
import type { MeStatsResponse } from '../../../../shared/src/events.js';
import { DEFAULT_PALETTE, intensityCell } from '../heatmap.js';
import { IntensityLegend } from '../layout/intensity-legend.js';

export function DayStrip({ data }: { data: MeStatsResponse }) {
  const ts = [...(data.timeseries ?? [])].sort(
    (a, b) => a.bucket_start - b.bucket_start,
  );
  const empty = ts.length === 0;
  const sampled = empty
    ? Array.from({ length: 7 }, (_, i) => ({
        bucket_start: Date.now() - (6 - i) * 86_400_000,
        fires: 0,
        hits: 0,
      }))
    : ts;

  const values = sampled.map((t) => (t.fires ?? 0) + (t.hits ?? 0));
  const max = Math.max(1, ...values);
  const cells = values.map((v) => intensityCell(v, max, DEFAULT_PALETTE));
  const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;
  const labels = sampled.map((t) => DOW[new Date(t.bucket_start).getDay()]!);
  const cellWidth = 3;

  return (
    <Box flexDirection="column">
      <Text bold>Last 7 days</Text>
      <Box marginTop={1} flexDirection="column">
        <Text color="gray">
          {labels.map((l, i) => l + (i < labels.length - 1 ? ' ' : '')).join('')}
        </Text>
        <Text>
          {cells.map((c, i) => (
            <Text key={i}>
              <Text color={c.color}>{c.ch.repeat(cellWidth)}</Text>
              {i < cells.length - 1 ? <Text> </Text> : null}
            </Text>
          ))}
        </Text>
        <IntensityLegend />
      </Box>
    </Box>
  );
}
