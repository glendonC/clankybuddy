// Stat tile grid · two columns per row, properly aligned.
//
// Four vertical alignment points across the whole grid:
//   1. Left labels   · left-aligned at col 0
//   2. Left values   · start at col (maxLeftLabel + 2) · after "label: "
//   3. Right labels  · start at col (leftBlockWidth + gap)
//   4. Right values  · start at col (rightLabelStart + maxRightLabel + 2)
//
// Labels within each column are padded to the widest label in that column,
// so VALUES line up vertically · you can scan down "0" "0 hits" "0 days"
// instead of doing per-row eye saccades to find where each value starts.
//
// When the two-column row width would exceed `interior` we fall back to
// a single-column stack · without this guard Ink wraps the right tile
// to its own line and the modal goes lopsided.

import { Box, Text } from 'ink';
import { padEnd } from '../pad.js';

export function StatGrid({
  rows,
  interior,
}: {
  rows: ReadonlyArray<ReadonlyArray<readonly [string, string]>>;
  interior: number;
}) {
  // Per-column max widths so labels and values line up vertically.
  const maxLeftLabel = rows.reduce(
    (m, row) => Math.max(m, row[0]?.[0].length ?? 0),
    0,
  );
  const maxRightLabel = rows.reduce(
    (m, row) => Math.max(m, row[1]?.[0].length ?? 0),
    0,
  );
  const maxLeftValue = rows.reduce(
    (m, row) => Math.max(m, row[0]?.[1].length ?? 0),
    0,
  );
  const maxRightValue = rows.reduce(
    (m, row) => Math.max(m, row[1]?.[1].length ?? 0),
    0,
  );

  // Two-column row width: left tile + gap + right tile. If this exceeds
  // the interior we fall back to one column per line · Ink would
  // otherwise wrap the right tile to a new line and pull the modal out
  // of shape.
  const interTileGap = 4;
  const leftTileWidth = maxLeftLabel + 2 + maxLeftValue;
  const rightTileWidth = maxRightLabel + 2 + maxRightValue;
  const twoColWidth = leftTileWidth + interTileGap + rightTileWidth;
  const fitsTwoCol = twoColWidth <= interior;

  if (!fitsTwoCol) {
    // Single-column fallback. Pad each label to a unified width across
    // BOTH original columns so all values line up in one stack.
    const unifiedLabel = Math.max(maxLeftLabel, maxRightLabel);
    const flat: Array<readonly [string, string]> = [];
    for (const row of rows) {
      if (row[0]) flat.push(row[0]);
      if (row[1]) flat.push(row[1]);
    }
    return (
      <Box flexDirection="column">
        {flat.map((cell, i) => (
          <Text key={i}>
            <Text color="gray">{padEnd(cell[0], unifiedLabel)}: </Text>
            <Text>{cell[1]}</Text>
          </Text>
        ))}
      </Box>
    );
  }

  const rightStartAt = Math.min(
    leftTileWidth + interTileGap,
    Math.floor(interior / 2),
  );

  return (
    <Box flexDirection="column">
      {rows.map((row, i) => {
        const left = row[0];
        const right = row[1];
        if (!left) return null;
        const leftLabelPadded = padEnd(left[0], maxLeftLabel);
        const leftValuePadded = padEnd(left[1], maxLeftValue);
        const consumedSoFar = maxLeftLabel + 2 + maxLeftValue;
        const pad = Math.max(interTileGap, rightStartAt - consumedSoFar);
        return (
          <Text key={i}>
            <Text color="gray">{leftLabelPadded}: </Text>
            <Text>{leftValuePadded}</Text>
            <Text>{' '.repeat(pad)}</Text>
            {right ? (
              <>
                <Text color="gray">{padEnd(right[0], maxRightLabel)}: </Text>
                <Text>{right[1]}</Text>
              </>
            ) : null}
          </Text>
        );
      })}
    </Box>
  );
}
