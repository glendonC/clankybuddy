// Two heatmap renderers shared by the stats modal.
//
//   buildCalendarHeatmap · GitHub-style 7×N grid (Sun-Sat rows, weeks as
//   columns) over a fixed date span. Uses 4-level intensity buckets.
//
//   buildTimeOfDayHeatmap · 7×24 grid (day-of-week rows, hour-of-day cols)
//   showing when in the week activity happens. Same intensity buckets.
//
// Both return arrays of rendered rows that the modal stacks vertically.
// Each cell renders as a single Unicode block char with a color picked
// from a 4-step scale. We vary GLYPH and COLOR together so the gradient is
// readable even on terminals that crush low-contrast palettes.

export interface HeatCell {
  ch: string;
  color: string;
}

export interface HeatRow {
  // Row label rendered to the left of cells (e.g. "Mon"). Empty string
  // for unlabeled rows. Caller right-pads to a shared width.
  label: string;
  cells: HeatCell[];
}

export interface CalendarHeatmap {
  rows: HeatRow[];
  // Month-name strip rendered above the grid. Already padded to match the
  // grid's column width.
  monthHeader: string;
  // Four legend cells (one per intensity step). Modal renders each in its
  // own <Text color={...}> alongside "Less" / "More" labels.
  legendCells: HeatCell[];
}

// Symmetric pair: empty cells are dim, dense cells are bright. Four density
// steps (0 = empty, 1-3 = increasing). Caller can pass a custom palette so
// the heatmap can be tinted to the active model accent if desired.
const INTENSITY_GLYPHS = ['░', '▒', '▓', '█'] as const;

export interface IntensityPalette {
  // 4-step palette · index 0 = empty/no-data; index 3 = max density.
  // Each entry can be a named Ink color or '#rrggbb'.
  colors: readonly [string, string, string, string];
}

const DEFAULT_PALETTE: IntensityPalette = {
  colors: ['gray', '#3a4a3a', '#5a8a5a', '#9be29b'],
};

// Sun..Sat order so daily_calendar (which uses UTC ISO dates) can be
// indexed by the corresponding Date.getUTCDay().
const DOW_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;
const MONTH_LABELS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
] as const;

export function buildCalendarHeatmap(
  daily: ReadonlyArray<{
    date: string;
    fires?: number;
    hits?: number;
    help_mood?: number;
    hurt_mood?: number;
  }>,
  windowDays: number,
  metric: 'fires' | 'hits' | 'activity',
  palette: IntensityPalette = DEFAULT_PALETTE,
): CalendarHeatmap {
  // Build a date-keyed map for O(1) lookup.
  const byDate = new Map<string, number>();
  for (const d of daily) {
    const v =
      metric === 'fires'
        ? d.fires ?? 0
        : metric === 'hits'
          ? d.hits ?? 0
          : (d.fires ?? 0) + (d.hits ?? 0);
    if (v > 0) byDate.set(d.date, v);
  }

  // Anchor the grid so the rightmost column is the current week. Walk
  // backwards by `windowDays` days from today, then align to a Sunday.
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const oldest = new Date(today.getTime() - (windowDays - 1) * 86_400_000);
  const oldestDow = oldest.getUTCDay();
  const gridStart = new Date(oldest.getTime() - oldestDow * 86_400_000);

  const totalDays =
    Math.floor((today.getTime() - gridStart.getTime()) / 86_400_000)
    + 1
    + (6 - today.getUTCDay());
  const weeks = Math.ceil(totalDays / 7);

  // Max for normalization. We use the raw max here · at this scale (≤365
  // values), trimmed-max smoothing adds complexity without payoff.
  let maxVal = 0;
  for (const v of byDate.values()) {
    if (v > maxVal) maxVal = v;
  }
  if (maxVal === 0) maxVal = 1;

  // 7 rows (Sun..Sat) × N columns. Cells in the future render as blanks
  // so the rightmost edge tapers naturally.
  const rows: HeatRow[] = [];
  for (let dow = 0; dow < 7; dow++) {
    const cells: HeatCell[] = [];
    for (let w = 0; w < weeks; w++) {
      const day = new Date(gridStart.getTime() + (w * 7 + dow) * 86_400_000);
      if (day > today) {
        cells.push({ ch: ' ', color: 'gray' });
        continue;
      }
      const iso = day.toISOString().slice(0, 10);
      const v = byDate.get(iso) ?? 0;
      cells.push(cellForValue(v, maxVal, palette));
    }
    // Mon/Wed/Fri labels only · matches GitHub + Claude Code spacing.
    const label =
      dow === 1 ? 'Mon' : dow === 3 ? 'Wed' : dow === 5 ? 'Fri' : '';
    rows.push({ label, cells });
  }

  const monthHeader = buildMonthHeader(gridStart, weeks);

  const legendCells: HeatCell[] = palette.colors.map((c, i) => ({
    ch: INTENSITY_GLYPHS[i]!,
    color: c,
  }));

  return { rows, monthHeader, legendCells };
}

export function buildTimeOfDayHeatmap(
  cells: ReadonlyArray<{
    dow: number;
    hour: number;
    fires?: number;
    hits?: number;
  }>,
  metric: 'fires' | 'hits' | 'activity',
  palette: IntensityPalette = DEFAULT_PALETTE,
): HeatRow[] {
  // (dow, hour) → metric.
  const table: number[][] = Array.from({ length: 7 }, () =>
    new Array(24).fill(0),
  );
  for (const c of cells) {
    if (c.dow < 0 || c.dow > 6 || c.hour < 0 || c.hour > 23) continue;
    const v =
      metric === 'fires'
        ? c.fires ?? 0
        : metric === 'hits'
          ? c.hits ?? 0
          : (c.fires ?? 0) + (c.hits ?? 0);
    table[c.dow]![c.hour]! += v;
  }
  let maxVal = 0;
  for (const row of table) {
    for (const v of row) {
      if (v > maxVal) maxVal = v;
    }
  }
  if (maxVal === 0) maxVal = 1;

  const out: HeatRow[] = [];
  for (let dow = 0; dow < 7; dow++) {
    const cellsOut: HeatCell[] = [];
    for (let h = 0; h < 24; h++) {
      cellsOut.push(cellForValue(table[dow]![h]!, maxVal, palette));
    }
    out.push({ label: DOW_LABELS[dow]!, cells: cellsOut });
  }
  return out;
}

// Exported · short-window strips (HourStrip / DayStrip in view.tsx) reuse
// this so they share the calendar's 4-step palette + bucket thresholds.
export function intensityCell(
  v: number,
  max: number,
  palette: IntensityPalette = DEFAULT_PALETTE,
): HeatCell {
  return cellForValue(v, max, palette);
}

function cellForValue(
  v: number,
  max: number,
  palette: IntensityPalette,
): HeatCell {
  if (v <= 0) {
    return { ch: INTENSITY_GLYPHS[0]!, color: palette.colors[0]! };
  }
  // Three buckets carved out of [0, max]. The thresholds were tuned so a
  // burst of activity on one day doesn't grayscale-flatten the rest of
  // the calendar; 0-33 / 33-66 / 66-100 keeps the gradient legible across
  // sparse and dense datasets.
  const ratio = Math.min(1, v / max);
  let idx: 1 | 2 | 3;
  if (ratio < 0.33) idx = 1;
  else if (ratio < 0.66) idx = 2;
  else idx = 3;
  return { ch: INTENSITY_GLYPHS[idx]!, color: palette.colors[idx]! };
}

function buildMonthHeader(start: Date, weeks: number): string {
  // Calendar-correct positioning makes 5-Monday months (Mar, Jun, Aug, etc.)
  // visually drift relative to 4-Monday months · the gap between adjacent
  // labels becomes 1 vs 2 cols depending on which month came before. Even
  // if mathematically true, it reads as "uneven" at a glance.
  //
  // Instead: place month labels at a uniform 4-col stride and let labels
  // step through months sequentially from the first visible Monday. Each
  // label still names the right month for its slot · we just give up
  // ±1-col precision against the underlying grid so the header row reads
  // as a clean strip.
  const out: string[] = new Array(weeks).fill(' ');
  if (weeks < 3) return out.join('');

  const stride = 4; // 3 chars per label + 1 space gap
  const maxLabels = Math.floor((weeks + 1) / stride);
  if (maxLabels < 1) return out.join('');

  // Anchor on the month of the first visible Monday. Lifetime view's
  // gridStart is Sunday-aligned, so +1 day lands on Monday.
  const firstMonday = new Date(start.getTime() + 86_400_000);
  let monthIdx = firstMonday.getUTCMonth();

  for (let i = 0; i < maxLabels; i++) {
    const col = i * stride;
    if (col + 3 > weeks) break;
    const label = MONTH_LABELS[monthIdx]!;
    for (let j = 0; j < label.length; j++) {
      out[col + j] = label[j]!;
    }
    monthIdx = (monthIdx + 1) % 12;
  }
  return out.join('');
}

export { DEFAULT_PALETTE };
