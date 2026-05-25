// Tools tab · top tools table + a "when you play" viz.
// 24h window: hour strip (a 7×24 dow-by-hour grid is mostly empty for
//             one day, so we degrade gracefully).
// 7d / lifetime: the full dow-by-hour heatmap, since the weekly pattern
//             is the actual story at those scales.

import { Box, Text } from 'ink';
import type { MeStatsResponse } from '../../../../shared/src/events.js';
import { fmtInt, fmtSigned } from '../../../../shared/src/stats/index.js';
import type { StatsWindow } from '../../me-stats.js';
import { buildHourAxisLabel } from '../axis.js';
import {
  buildTimeOfDayHeatmap,
} from '../heatmap.js';
import { padEnd, padStart } from '../pad.js';
import { HourStrip } from '../strips/hour-strip.js';

type TimeOfDayCell = NonNullable<MeStatsResponse['time_of_day_heatmap']>[number];

export function ToolsPane({
  data,
  win,
}: {
  data: MeStatsResponse;
  win: StatsWindow;
}) {
  const verbEntries = Object.entries(data.per_verb ?? {})
    .map(([verb, v]) => ({
      verb,
      fires: v.fires ?? 0,
      hits: v.hits ?? 0,
      mood: v.mood_delta_sum ?? 0,
    }))
    .filter((e) => e.fires > 0)
    .sort((a, b) => b.fires - a.fires);
  const topN = verbEntries.slice(0, Math.max(4, Math.min(10, verbEntries.length)));

  return (
    <Box flexDirection="column">
      {win === 'day' ? (
        <Box flexDirection="column">
          <Text bold>When you played · last 24 hours</Text>
          <Box marginTop={1}>
            <HourStrip data={data} />
          </Box>
        </Box>
      ) : (
        <ToolHeatmap data={data} />
      )}

      <Box marginTop={1} flexDirection="column">
        <Text bold>Top tools</Text>
        {topN.length === 0 ? (
          <Box flexDirection="column" marginTop={1}>
            <ToolsHeader />
            {[1, 2, 3, 4].map((i) => (
              <Text key={i}>
                <Text color="gray">{padStart(`${i}.`, 3)} </Text>
                <Text color="gray">{padEnd('—', 14)}</Text>
                <Text color="gray">no data</Text>
              </Text>
            ))}
          </Box>
        ) : (
          <Box flexDirection="column" marginTop={1}>
            <ToolsHeader />
            {topN.map((v, i) => (
              <Text key={v.verb}>
                <Text color="gray">{padStart(`${i + 1}.`, 3)} </Text>
                <Text>{padEnd(v.verb, 14)}</Text>
                <Text>{padStart(fmtInt(v.fires), 8)}</Text>
                <Text>{'  '}</Text>
                <Text>{padStart(fmtInt(v.hits), 8)}</Text>
                <Text>{'  '}</Text>
                <Text color={v.mood >= 0 ? 'green' : 'red'}>
                  {padStart(fmtSigned(v.mood), 8)}
                </Text>
              </Text>
            ))}
          </Box>
        )}
      </Box>
    </Box>
  );
}

// Column headers for the Top tools table. Mirrors the Models tab idiom ·
// gray, right-aligned over numeric columns, blank above the rank+name
// columns (those are self-explanatory). Widths match the data rows so
// the labels sit directly above their values.
function ToolsHeader() {
  return (
    <Text>
      <Text>{'    '}</Text>{/* rank "1. " (3) + space (1) */}
      <Text>{' '.repeat(14)}</Text>{/* verb column · blank */}
      <Text color="gray">{padStart('used', 8)}</Text>
      <Text>{'  '}</Text>
      <Text color="gray">{padStart('hits', 8)}</Text>
      <Text>{'  '}</Text>
      <Text color="gray">{padStart('mood', 8)}</Text>
    </Text>
  );
}

// 7×24 dow-by-hour heatmap with the canonical axis labels.
function ToolHeatmap({ data }: { data: MeStatsResponse }) {
  const cells: TimeOfDayCell[] = data.time_of_day_heatmap ?? [];
  const heatRows = buildTimeOfDayHeatmap(cells, 'activity');
  const dowWidth = 4;
  const hourLabelRow = ' '.repeat(dowWidth) + buildHourAxisLabel(24);
  return (
    <Box flexDirection="column">
      <Text bold>When you play</Text>
      <Box flexDirection="column" marginTop={1}>
        {heatRows.map((row, i) => (
          <Text key={i}>
            <Text color="gray">{padEnd(row.label, dowWidth)}</Text>
            {row.cells.map((cell, j) => (
              <Text key={j} color={cell.color}>
                {cell.ch}
              </Text>
            ))}
          </Text>
        ))}
        <Text color="gray">{hourLabelRow}</Text>
      </Box>
    </Box>
  );
}
