// GitHub-style 7×N daily-activity heatmap. Driven by data.daily_calendar
// (per-user, populated on the personal path). Trimmed from the right so
// "today" stays anchored to the right edge of the strip · width adapts
// to interior so wide terminals see more of the past year.

import { Box, Text } from 'ink';
import type { MeStatsResponse } from '../../../../shared/src/events.js';
import { buildCalendarHeatmap, type HeatRow } from '../heatmap.js';
import { IntensityLegend } from '../layout/intensity-legend.js';
import { padEnd } from '../pad.js';

export function CalendarHeatmap({
  data,
  interior,
}: {
  data: MeStatsResponse;
  interior: number;
}) {
  const heat = buildCalendarHeatmap(data.daily_calendar ?? [], 365, 'activity');
  const gutter = 4;
  const maxWeeks = Math.max(8, interior - gutter);
  const trimmedRows: HeatRow[] = heat.rows.map((r) => ({
    label: r.label,
    cells: r.cells.slice(Math.max(0, r.cells.length - maxWeeks)),
  }));
  const trimmedHeader = heat.monthHeader.slice(
    Math.max(0, heat.monthHeader.length - maxWeeks),
  );
  return (
    <Box flexDirection="column">
      <Text>
        <Text>{' '.repeat(gutter)}</Text>
        <Text color="gray">{trimmedHeader}</Text>
      </Text>
      {trimmedRows.map((row, i) => (
        <Text key={i}>
          <Text color="gray">{padEnd(row.label, gutter)}</Text>
          {row.cells.map((cell, j) => (
            <Text key={j} color={cell.color}>
              {cell.ch}
            </Text>
          ))}
        </Text>
      ))}
      <IntensityLegend cells={heat.legendCells} />
    </Box>
  );
}
