// Loading and error placeholders for the stats modal body. Sized to
// match the rough vertical footprint of a real pane so the modal
// doesn't visually pop when the data resolves.

import { Box, Text } from 'ink';

export function LoadingPane() {
  return (
    <Box paddingY={1}>
      <Text color="gray">fetching stats…</Text>
    </Box>
  );
}

export function ErrorPane({ message }: { message: string }) {
  return (
    <Box flexDirection="column" paddingY={1}>
      <Text color="red">couldn't load stats</Text>
      <Text color="gray">{message}</Text>
    </Box>
  );
}
