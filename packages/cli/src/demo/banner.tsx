// Always-on demo banner. Renders nothing when isDemoMode() is false so
// every call site can wrap unconditionally. Yellow-on-black per the
// repo's terminal-stable filled-pill convention.

import { Box, Text } from 'ink';
import { getScenarioName, getScenarioSpec, isDemoMode } from './index.js';

export function DemoBanner() {
  if (!isDemoMode()) return null;
  const name = getScenarioName();
  const spec = getScenarioSpec();
  return (
    <Box paddingX={1}>
      <Text backgroundColor="yellow" color="black" bold>
        {`  DEMO ${name}  `}
      </Text>
      <Text color="gray">{`  ${spec.label} · seed 0x${spec.seed.toString(16)}`}</Text>
    </Box>
  );
}
