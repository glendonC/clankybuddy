// Step-line chart using Unicode box-drawing characters. Each data point
// occupies one terminal column; adjacent points connect via crisp single-
// pixel-wide line segments built from box-drawing primitives.
//
// Why step lines instead of Braille smooth lines:
//   Braille (2×4 dot grid per cell) gives sub-pixel resolution but lines
//   appear dotted/sparse at typical data densities. Step charts use solid
//   ─ │ ┌ ┐ └ ┘ corners that the terminal renders as crisp continuous
//   strokes · the same technique Claude Code's /cost dashboard uses for
//   its tokens-per-day chart. The visual quality is markedly cleaner for
//   typical use cases (handfuls to hundreds of buckets).
//
// Multi-series: each series traces its own polyline; we maintain a
// direction-bit mask per cell so when two series' lines pass through the
// same cell the rendered glyph correctly shows all directions (e.g. a
// vertical bar crossing a horizontal becomes ┼). Color is per-cell with
// last-series-to-touch winning · later series overlay earlier.

// Direction bits · OR-able. A cell's bits map to a single Unicode glyph.
const RIGHT = 1;
const DOWN = 2;
const LEFT = 4;
const UP = 8;

const BOX_CHAR: ReadonlyArray<string> = (() => {
  const arr = new Array(16).fill(' ');
  arr[0] = ' ';
  arr[RIGHT] = '╶';
  arr[DOWN] = '╷';
  arr[LEFT] = '╴';
  arr[UP] = '╵';
  arr[RIGHT | LEFT] = '─';
  arr[DOWN | UP] = '│';
  arr[RIGHT | DOWN] = '┌';
  arr[LEFT | DOWN] = '┐';
  arr[RIGHT | UP] = '└';
  arr[LEFT | UP] = '┘';
  arr[RIGHT | LEFT | DOWN] = '┬';
  arr[RIGHT | LEFT | UP] = '┴';
  arr[RIGHT | DOWN | UP] = '├';
  arr[LEFT | DOWN | UP] = '┤';
  arr[RIGHT | LEFT | DOWN | UP] = '┼';
  return arr;
})();

export interface Series {
  // Display name (legend). Required for the legend; chart itself is
  // keyed on array index, not name.
  name: string;
  // One number per bucket. Missing buckets should be `null` so we can
  // break the polyline cleanly rather than interpolating across a gap.
  values: ReadonlyArray<number | null>;
  // Ink color string · standard names ('cyan', 'magenta') or '#rrggbb'.
  color: string;
}

export interface ChartOptions {
  // Width and height in CHARACTER cells. Each data point gets one column;
  // if data length < width, points spread out via colOf below.
  width: number;
  height: number;
  yMin?: number;
  yMax?: number;
  yTicks?: number;
  // Label policy. 'auto' (default) labels every row using yMin/yMax.
  // 'baseline' labels only the bottom row ("0") and leaves the rest
  // unlabeled · used for the empty-data chassis so we don't fabricate a
  // numeric scale (no data means no real numbers to put on the axis).
  yLabels?: 'auto' | 'baseline';
}

export interface RenderedRow {
  axisLabel: string;
  runs: { color: string; text: string }[];
}

export interface RenderedChart {
  rows: RenderedRow[];
  xAxisLine: string;
  axisGutter: string;
  xAxisLabels: string;
}

export function renderChart(
  series: ReadonlyArray<Series>,
  xLabels: ReadonlyArray<string>,
  options: ChartOptions,
): RenderedChart {
  const { width, height } = options;
  if (width < 8 || height < 3) {
    throw new Error(`chart too small: ${width}x${height}`);
  }

  // Y-range derivation. We anchor min at 0 so the baseline always has a
  // meaningful zero, and add 10% headroom on top so peaks don't ride the
  // chart's top edge. Empty/zero data still produces a unit axis so the
  // chassis renders.
  let yMin = options.yMin;
  let yMax = options.yMax;
  if (yMin == null || yMax == null) {
    let dataMin = Infinity;
    let dataMax = -Infinity;
    for (const s of series) {
      for (const v of s.values) {
        if (v == null) continue;
        if (v < dataMin) dataMin = v;
        if (v > dataMax) dataMax = v;
      }
    }
    if (!Number.isFinite(dataMin) || !Number.isFinite(dataMax)) {
      dataMin = 0;
      dataMax = 1;
    }
    yMin = options.yMin ?? Math.min(0, dataMin);
    const span = Math.max(dataMax - yMin, 1);
    yMax = options.yMax ?? yMin + span * 1.1;
  }
  const ySpan = yMax - yMin;

  // Bit canvas + owner canvas. owners[r][c] = -1 means empty.
  const bits: number[][] = Array.from({ length: height }, () =>
    new Array(width).fill(0),
  );
  const owners: number[][] = Array.from({ length: height }, () =>
    new Array(width).fill(-1),
  );

  const setBits = (col: number, row: number, dirBits: number, seriesIdx: number) => {
    if (col < 0 || col >= width || row < 0 || row >= height) return;
    bits[row]![col]! |= dirBits;
    if (dirBits !== 0) owners[row]![col]! = seriesIdx;
  };

  const valueToRow = (v: number): number => {
    if (ySpan <= 0) return Math.floor((height - 1) / 2);
    const frac = (v - yMin!) / ySpan;
    return Math.round((1 - Math.max(0, Math.min(1, frac))) * (height - 1));
  };

  // Draw each series as a step polyline. Coordinate convention:
  //   row 0 = top of chart (yMax), row height-1 = bottom (yMin)
  //   col 0 = left, col width-1 = right
  //
  // Each contiguous run of non-null values is CLOSED to the baseline at
  // both ends · the line rises from the baseline at the run's first
  // column and descends back to the baseline at the run's last column.
  // Result: the chart reads as a continuous bar-top outline rather than
  // a floating line with `╶`/`╴` stubs hanging in mid-air.
  const baselineRow = height - 1;
  const drawVerticalToBaseline = (
    col: number,
    row: number,
    seriesIdx: number,
  ) => {
    if (row >= baselineRow) {
      setBits(col, row, 0, seriesIdx);
      return;
    }
    setBits(col, row, DOWN, seriesIdx);
    for (let y = row + 1; y < baselineRow; y++) {
      setBits(col, y, UP | DOWN, seriesIdx);
    }
    setBits(col, baselineRow, UP, seriesIdx);
  };
  const drawVerticalFromBaseline = (
    col: number,
    row: number,
    seriesIdx: number,
  ) => {
    if (row >= baselineRow) {
      setBits(col, row, 0, seriesIdx);
      return;
    }
    setBits(col, baselineRow, UP, seriesIdx);
    for (let y = baselineRow - 1; y > row; y--) {
      setBits(col, y, UP | DOWN, seriesIdx);
    }
    setBits(col, row, DOWN, seriesIdx);
  };

  for (let s = 0; s < series.length; s++) {
    const values = series[s]!.values;
    const n = values.length;
    if (n === 0) continue;

    const colOf = (idx: number): number => {
      if (n === 1) return Math.floor(width / 2);
      return Math.round((idx / (n - 1)) * (width - 1));
    };

    let prevCol = -1;
    let prevRow = -1;

    // Walk n+1 to flush a trailing close-to-baseline when the last
    // value is non-null. The synthetic final iteration uses i === n.
    for (let i = 0; i <= n; i++) {
      const v = i < n ? values[i] : null;
      if (v == null) {
        // End of a contiguous run · close down to baseline if we have
        // an open prev point.
        if (prevCol !== -1) {
          drawVerticalToBaseline(prevCol, prevRow, s);
        }
        prevCol = -1;
        prevRow = -1;
        continue;
      }
      const col = colOf(i);
      const row = valueToRow(v);

      if (prevCol === -1) {
        // Start of a contiguous run · rise from baseline up to first row.
        drawVerticalFromBaseline(col, row, s);
      } else {
        // Horizontal segment at prevRow from prevCol to col.
        if (col > prevCol) {
          for (let x = prevCol; x < col; x++) {
            if (x === prevCol) {
              setBits(x, prevRow, RIGHT, s);
            } else {
              setBits(x, prevRow, LEFT | RIGHT, s);
            }
          }
          setBits(col, prevRow, LEFT, s);
        }

        // Vertical segment at col from prevRow to row.
        if (row !== prevRow) {
          if (row < prevRow) {
            setBits(col, prevRow, UP, s);
            for (let y = prevRow - 1; y > row; y--) {
              setBits(col, y, UP | DOWN, s);
            }
            setBits(col, row, DOWN, s);
          } else {
            setBits(col, prevRow, DOWN, s);
            for (let y = prevRow + 1; y < row; y++) {
              setBits(col, y, UP | DOWN, s);
            }
            setBits(col, row, UP, s);
          }
        }
      }
      prevCol = col;
      prevRow = row;
    }
  }

  const labelByRow = new Map<number, string>();
  if (options.yLabels === 'baseline') {
    // Only the baseline gets a label · used by callers with no data to
    // avoid putting fabricated numeric ticks on an empty chart.
    labelByRow.set(height - 1, '0');
  } else {
    // One y-axis label per row · matches Claude Code's tokens-per-day
    // chart density. Sparser labels (every 2-3 rows) made the axis read
    // as half-baked. Caller can override via options.yTicks if they
    // want fewer for a deliberately minimal chassis.
    const yTicks = options.yTicks ?? height;
    for (let t = 0; t < yTicks; t++) {
      const rowF = (t / Math.max(1, yTicks - 1)) * (height - 1);
      const row = Math.round(rowF);
      const valueAtRow = yMax - (row / (height - 1)) * ySpan;
      labelByRow.set(row, formatYTick(valueAtRow));
    }
  }
  const axisLabelWidth = Math.max(
    ...Array.from(labelByRow.values(), (s) => s.length),
    0,
  ) + 1;

  // Build rendered rows. Group consecutive same-color cells into runs so
  // Ink emits one <Text> per run rather than per cell.
  const rows: RenderedRow[] = [];
  for (let r = 0; r < height; r++) {
    const runs: { color: string; text: string }[] = [];
    let curColor = '';
    let curText = '';
    const flush = () => {
      if (curText.length > 0) {
        runs.push({ color: curColor, text: curText });
        curText = '';
      }
    };
    for (let c = 0; c < width; c++) {
      const b = bits[r]![c]!;
      const owner = owners[r]![c]!;
      const ch = BOX_CHAR[b] ?? ' ';
      const color = b === 0 || owner < 0 ? 'gray' : series[owner]!.color;
      if (color !== curColor && curText.length > 0) {
        flush();
      }
      curColor = color;
      curText += ch;
    }
    flush();

    const rawLabel = labelByRow.get(r) ?? '';
    const axisLabel =
      rawLabel === ''
        ? ' '.repeat(axisLabelWidth - 1) + '│'
        : padStart(rawLabel, axisLabelWidth - 1) + '┤';
    rows.push({ axisLabel, runs });
  }

  const xAxisLine = '─'.repeat(width);
  const axisGutter = ' '.repeat(axisLabelWidth - 1) + '└';
  const xAxisLabels = layoutXLabels(xLabels, width);

  return {
    rows,
    xAxisLine,
    axisGutter,
    xAxisLabels,
  };
}

// 1.2K / 9.8M / 7 / 0 · bounded to ~4 chars so labels stay column-aligned.
// Integers render without decimals so empty-state axes (which use a 0..N
// integer scale) read as clean whole numbers rather than "7.0".
export function formatYTick(value: number): string {
  if (value === 0) return '0';
  const abs = Math.abs(value);
  const sign = value < 0 ? '-' : '';
  if (abs >= 1_000_000) {
    const mag = abs / 1_000_000;
    return sign + (mag < 10 ? mag.toFixed(1) : Math.round(mag).toString()) + 'M';
  }
  if (abs >= 1_000) {
    const mag = abs / 1_000;
    return sign + (mag < 10 ? mag.toFixed(1) : Math.round(mag).toString()) + 'K';
  }
  // Effectively integer? Drop the decimal so "7.0" becomes "7".
  if (Math.abs(value - Math.round(value)) < 0.05) {
    return sign + Math.round(abs).toString();
  }
  if (abs < 10) return sign + abs.toFixed(1);
  return sign + Math.round(abs).toString();
}

function padStart(s: string, w: number): string {
  return s.length >= w ? s : ' '.repeat(w - s.length) + s;
}

function layoutXLabels(labels: ReadonlyArray<string>, width: number): string {
  if (labels.length === 0) return ' '.repeat(width);
  if (labels.length === 1) return padCenter(labels[0]!, width);

  const left = labels[0] ?? '';
  const right = labels[labels.length - 1] ?? '';
  if (labels.length === 2) {
    const padBetween = Math.max(1, width - left.length - right.length);
    return (left + ' '.repeat(padBetween) + right).slice(0, width);
  }
  const mid = labels[Math.floor(labels.length / 2)] ?? '';
  const midPos = Math.floor((width - mid.length) / 2);
  let out = left;
  const padToMid = midPos - out.length;
  if (padToMid > 0) out += ' '.repeat(padToMid);
  out += mid;
  const padToRight = width - right.length - out.length;
  if (padToRight > 0) out += ' '.repeat(padToRight);
  out += right;
  return out.slice(0, width);
}

function padCenter(s: string, w: number): string {
  if (s.length >= w) return s.slice(0, w);
  const pad = w - s.length;
  const left = Math.floor(pad / 2);
  return ' '.repeat(left) + s + ' '.repeat(pad - left);
}

// ---------------------------------------------------------------------------
// Sparkline · single-row unicode block bar for per-row activity. Used by the
// Models pane so each persona shows its own activity shape without piling
// six step-lines onto the same chart.
// ---------------------------------------------------------------------------

const SPARK_BLOCKS = ['▁', '▂', '▃', '▄', '▅', '▆', '▇', '█'] as const;

// Downsample `values` to `width` buckets by averaging, then map each bucket
// to one of 8 block heights proportional to the global max. Empty (max=0)
// input renders as `width` low-baseline dots so the column slot keeps its
// shape even for inactive personas. Width <= 0 returns the empty string.
export function renderSparkline(
  values: ReadonlyArray<number>,
  width: number,
): string {
  if (width <= 0) return '';
  if (values.length === 0) return '┄'.repeat(width);
  const max = Math.max(0, ...values);
  if (max <= 0) return '┄'.repeat(width);
  const out: string[] = [];
  for (let i = 0; i < width; i++) {
    const a = Math.floor((i * values.length) / width);
    const b = Math.max(a + 1, Math.floor(((i + 1) * values.length) / width));
    let sum = 0;
    let n = 0;
    for (let k = a; k < b && k < values.length; k++) {
      sum += values[k] ?? 0;
      n++;
    }
    const avg = n > 0 ? sum / n : 0;
    if (avg <= 0) {
      out.push(SPARK_BLOCKS[0]!);
      continue;
    }
    const idx = Math.min(
      SPARK_BLOCKS.length - 1,
      Math.max(0, Math.round((avg / max) * (SPARK_BLOCKS.length - 1))),
    );
    out.push(SPARK_BLOCKS[idx]!);
  }
  return out.join('');
}
