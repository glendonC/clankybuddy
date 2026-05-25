// Shared legend used by all activity strips. Cells default to the
// canonical 4-step palette · the calendar overrides with its own
// to stay consistent with the rows above it.

import { Box, Text } from 'ink';
import { DEFAULT_PALETTE } from '../heatmap.js';

export function IntensityLegend({
  cells,
}: {
  cells?: ReadonlyArray<{ ch: string; color: string }>;
} = {}) {
  const resolved = cells ?? [
    { ch: '░', color: DEFAULT_PALETTE.colors[0]! },
    { ch: '▒', color: DEFAULT_PALETTE.colors[1]! },
    { ch: '▓', color: DEFAULT_PALETTE.colors[2]! },
    { ch: '█', color: DEFAULT_PALETTE.colors[3]! },
  ];
  return (
    <Box marginTop={1}>
      <Text color="gray">Less </Text>
      {resolved.map((c, i) => (
        <Text key={i} color={c.color}>
          {c.ch}
        </Text>
      ))}
      <Text color="gray"> More</Text>
    </Box>
  );
}
