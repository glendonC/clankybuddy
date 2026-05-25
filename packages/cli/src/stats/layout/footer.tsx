// Time-range pills + command-hint line. Pills use yellow (gold) fill
// rather than cyan so they're visually distinct from the tab pills
// above · tabs = primary structural nav, time range = secondary
// filter, distinct color tells the user they're different controls.

import { Box, Text } from 'ink';
import type { StatsWindow } from '../../me-stats.js';
import { WINDOWS, type ViewMode } from '../types.js';

export function Footer({
  win,
  viewMode,
}: {
  win: StatsWindow;
  viewMode: ViewMode;
}) {
  return (
    <Box flexDirection="column" marginTop={1}>
      <Box>
        {WINDOWS.map((w, i) => {
          const padded = `  ${w.label}  `;
          return (
            <Text key={w.id}>
              {i > 0 ? <Text> </Text> : null}
              {w.id === win ? (
                <Text backgroundColor="yellow" color="black" bold>
                  {padded}
                </Text>
              ) : (
                <Text color="gray">{padded}</Text>
              )}
            </Text>
          );
        })}
      </Box>
      <Box marginTop={1}>
        <Text>
          <Text color="cyan">[← →]</Text>
          <Text color="gray"> tab</Text>
          <Text>   </Text>
          <Text color="cyan">[r]</Text>
          <Text color="gray"> range</Text>
          <Text>   </Text>
          <Text color="cyan">[g]</Text>
          <Text color="gray">{viewMode === 'global' ? ' you' : ' global'}</Text>
          <Text>   </Text>
          <Text color="cyan">[esc]</Text>
          <Text color="gray"> back</Text>
        </Text>
      </Box>
    </Box>
  );
}
