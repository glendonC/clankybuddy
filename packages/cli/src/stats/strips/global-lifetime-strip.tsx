// Lifetime activity in global mode. Uses data.timeseries (always
// populated for any mode/window) instead of daily_calendar (per-user
// only). Renders as a wide intensity strip · same vocabulary as
// HourStrip/DayStrip but stretched across the interior with a 1-char
// cell width so we can fit ~90d of buckets at typical widths.

import { Box, Text } from 'ink';
import type { MeStatsResponse } from '../../../../shared/src/events.js';
import { fmtShortDate } from '../../../../shared/src/stats/index.js';
import { DEFAULT_PALETTE, intensityCell } from '../heatmap.js';
import { IntensityLegend } from '../layout/intensity-legend.js';

export function GlobalLifetimeStrip({
  data,
  interior,
}: {
  data: MeStatsResponse;
  interior: number;
}) {
  const ts = [...(data.timeseries ?? [])].sort(
    (a, b) => a.bucket_start - b.bucket_start,
  );
  if (ts.length === 0) {
    return (
      <Box flexDirection="column">
        <Text bold>Global activity</Text>
        <Text color="gray">no data in this window</Text>
      </Box>
    );
  }
  // Downsample so the strip fits the interior at 1 char per cell.
  const cellWidth = 1;
  const slots = Math.max(20, Math.min(ts.length, interior - 4));
  const bucketed: number[] = new Array(slots).fill(0);
  for (let i = 0; i < ts.length; i++) {
    const slot = Math.min(slots - 1, Math.floor((i * slots) / ts.length));
    bucketed[slot]! += (ts[i]!.fires ?? 0) + (ts[i]!.hits ?? 0);
  }
  const max = Math.max(1, ...bucketed);
  const cells = bucketed.map((v) => intensityCell(v, max, DEFAULT_PALETTE));
  const first = fmtShortDate(ts[0]!.bucket_start);
  const last = fmtShortDate(ts[ts.length - 1]!.bucket_start);
  return (
    <Box flexDirection="column">
      <Text bold>Global activity</Text>
      <Box marginTop={1} flexDirection="column">
        <Text>
          {cells.map((c, i) => (
            <Text key={i} color={c.color}>
              {c.ch.repeat(cellWidth)}
            </Text>
          ))}
        </Text>
        <Box>
          <Text color="gray">{first}</Text>
          <Box flexGrow={1} />
          <Text color="gray">{last}</Text>
        </Box>
        <IntensityLegend />
      </Box>
    </Box>
  );
}
