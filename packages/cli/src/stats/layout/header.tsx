// Tab pills + flush-right mode badge. Active tab is a cyan-on-black
// filled pill, inactive tabs are gray text padded to the same
// footprint so the row stays vertically aligned when the selection
// moves. `cyan` is the one terminal-stable filled color · we
// deliberately avoid `blackBright` here (welcome.tsx note about it
// rendering near-white on some themes is still in effect).

import { Box, Text } from 'ink';
import { TABS, type Tab, type ViewMode } from '../types.js';

export function Header({ tab, viewMode }: { tab: Tab; viewMode: ViewMode }) {
  return (
    <Box justifyContent="space-between">
      <Box>
        {TABS.map((t, i) => {
          const padded = `  ${t.label}  `;
          return (
            <Text key={t.id}>
              {i > 0 ? <Text> </Text> : null}
              {t.id === tab ? (
                <Text backgroundColor="cyan" color="black" bold>
                  {padded}
                </Text>
              ) : (
                <Text color="gray">{padded}</Text>
              )}
            </Text>
          );
        })}
      </Box>
      {/* Mode badge · flush-right, only when the view is global. The
          personal view is the default and doesn't need a label saying
          so · a "you" pill there is just visual noise. */}
      <Box>
        {viewMode === 'global' ? (
          <Text backgroundColor="magenta" color="black" bold>
            {'  GLOBAL  '}
          </Text>
        ) : null}
      </Box>
    </Box>
  );
}
