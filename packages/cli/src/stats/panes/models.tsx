// Models pane · single-persona FOCUS chart at top + ranked per-persona
// table below. Up/down arrows (handled by the parent useInput) cycle
// the focused persona; the chart instantly re-paints in that persona's
// color so distinguishing personas is trivial.
//
// Why single-series instead of a 3-line overlay:
//   The previous overlay rendered three terminal colors into the same
//   cells, with last-series-to-touch winning · personas overlapped most
//   of the time and the rendered colors looked random. A single focused
//   line answers "what does THIS persona look like" without the visual
//   mush · and the table-of-sparklines below already lets the user
//   compare personas at a glance.
//
// Each table row fits on ONE line at any interior width >= 36 via
// responsive column tiering (see showSpark / showPct / showMood below).

import { Box, Text } from 'ink';
import type { MeStatsResponse } from '../../../../shared/src/events.js';
import { type ModelId } from '../../../../shared/src/personas.js';
import {
  fmtInt,
  fmtSigned,
  perModelBuckets,
  rankPersonaIds,
  totalFires as totalFiresOf,
} from '../../../../shared/src/stats/index.js';
import type { StatsWindow } from '../../me-stats.js';
import { buildXAxisLabels, yAxisQuantityForWindow } from '../axis.js';
import { renderChart, renderSparkline, type Series } from '../chart.js';
import { CHART_COLORS } from '../colors.js';
import { padCenter, padEnd, padStart } from '../pad.js';

export function ModelsPane({
  data,
  interior,
  termRows,
  win,
  focused,
  onFocusChange,
}: {
  data: MeStatsResponse;
  interior: number;
  termRows: number;
  win: StatsWindow;
  focused: ModelId;
  onFocusChange: (id: ModelId) => void;
}) {
  // Auto-correct focus on every render: if the user's selection has
  // zero activity in this window (or doesn't exist yet), snap to the
  // top persona by fires. Cheap, no useEffect dance.
  const order = rankPersonaIds(data);
  const focusedFires = data.per_model[focused]?.fires ?? 0;
  const effectiveFocus: ModelId =
    focusedFires > 0 ? focused : order[0] ?? focused;
  // Only fire setState when the focus actually needs to change, so the
  // parent doesn't loop. Skip the auto-correct when the data is empty
  // for every persona — there's no useful "top" to pick.
  if (effectiveFocus !== focused && focusedFires === 0 && order.length > 0) {
    const topHasFires = (data.per_model[order[0]!]?.fires ?? 0) > 0;
    if (topHasFires) onFocusChange(effectiveFocus);
  }

  // Reserve 6 chars for the y-axis label gutter ("1.2K┤" worst case).
  const chartWidth = Math.max(20, Math.min(interior - 6, 80));
  // Cap aggressively. Box-drawing step lines read at 3 rows. We reserve
  // ~14 rows for everything below the chart (table + axis + spacing).
  const chartHeight = Math.max(3, Math.min(4, termRows - 20));

  const focusValues = perModelBuckets(data, effectiveFocus);
  const focusedHasActivity = focusValues.some((v) => (v ?? 0) > 0);
  const focusedColor = CHART_COLORS[effectiveFocus];

  const xLabels = buildXAxisLabels(data);
  const focusSeries: Series[] = focusedHasActivity
    ? [{ name: effectiveFocus, values: focusValues, color: focusedColor }]
    : [];

  const rendered = renderChart(focusSeries, xLabels, {
    width: chartWidth,
    height: chartHeight,
    ...(focusedHasActivity
      ? {}
      : { yMin: 0, yMax: 1, yLabels: 'baseline' as const }),
  });

  // Ranked rows. Always 6 personas — inactive ones still appear but
  // visually de-emphasized so the user can see "you've never tried X"
  // at a glance.
  const totalFires = totalFiresOf(data);
  const ranked = order.map((id) => {
    const m = data.per_model[id];
    return {
      id,
      fires: m?.fires ?? 0,
      hits: m?.hits ?? 0,
      help: m?.help_mood ?? 0,
      hurt: m?.hurt_mood ?? 0,
      pct: totalFires > 0 ? ((m?.fires ?? 0) / totalFires) * 100 : 0,
      spark: perModelBuckets(data, id),
    };
  });

  // Shared column widths so values line up vertically across rows. Name
  // is the longest persona id ("deepseek" = 8) + 1 trailing space. moodW
  // floored at 9 so the "help/hurt" column header always fits.
  const nameW = 9;
  const firesW = Math.max(5, ...ranked.map((r) => fmtInt(r.fires).length));
  const moodW = Math.max(
    9,
    ...ranked.map((r) => `${fmtSigned(r.help)}/${fmtSigned(-r.hurt)}`.length),
  );

  // Tier layout to terminal width. The leading 2-char marker ("▸ " /
  // "  ") is part of every row, so the budget is `interior - 2`.
  const rowBudget = interior - 2;
  const showSpark = rowBudget >= 44;
  const showPct = rowBudget >= 44;
  const showMood = rowBudget >= 36;
  const sparkW = showSpark ? Math.min(12, Math.max(6, rowBudget - 36)) : 0;

  return (
    <Box flexDirection="column">
      <Box>
        <Text bold>
          {yAxisQuantityForWindow(win)}
          {' · '}
        </Text>
        <Text color={focusedColor} bold>
          {effectiveFocus}
        </Text>
        {!focusedHasActivity ? (
          <Text color="gray">{'   no activity in this window'}</Text>
        ) : null}
      </Box>
      <Box marginTop={1} flexDirection="column">
        {rendered.rows.map((row, i) => (
          <Text key={i}>
            <Text color="gray">{row.axisLabel}</Text>
            {row.runs.map((run, j) => (
              <Text key={j} color={run.color}>
                {run.text}
              </Text>
            ))}
          </Text>
        ))}
        <Text>
          <Text color="gray">{rendered.axisGutter}</Text>
          <Text color="gray">{rendered.xAxisLine}</Text>
        </Text>
        <Text>
          <Text>{' '.repeat(rendered.axisGutter.length)}</Text>
          <Text color="gray">{rendered.xAxisLabels}</Text>
        </Text>
      </Box>

      <Box marginTop={1} flexDirection="column">
        {/* Column headers · only the columns whose meaning isn't self-
            evident get a label. Persona names need none (they're
            literally the words). Spark/pct/fires/mood do. Header row
            uses the same paddings as data rows so each label sits
            directly above its column. */}
        <Text>
          <Text>{'    '}</Text>{/* marker (2) + dot (2) */}
          <Text>{' '.repeat(nameW)}</Text>{/* name column · blank */}
          {showSpark ? (
            <>
              <Text color="gray">{padCenter('trend', sparkW)}</Text>
              <Text>{'  '}</Text>
            </>
          ) : null}
          {showPct ? (
            <>
              <Text color="gray">{padStart('%', 4)}</Text>
              <Text>{'  '}</Text>
            </>
          ) : null}
          <Text color="gray">{padStart('fires', firesW)}</Text>
          {showMood ? (
            <>
              <Text>{'  '}</Text>
              <Text color="gray">{padStart('help/hurt', moodW)}</Text>
            </>
          ) : null}
        </Text>
        {ranked.map((r) => {
          const inactive = r.fires === 0 && r.hits === 0;
          const isFocus = r.id === effectiveFocus;
          const dotColor = inactive ? 'gray' : CHART_COLORS[r.id];
          const sparkStr = showSpark ? renderSparkline(r.spark, sparkW) : '';
          const pctText = showPct
            ? padStart(r.pct >= 0.5 ? `${r.pct.toFixed(0)}%` : '·', 4)
            : '';
          const firesText = padStart(inactive ? '·' : fmtInt(r.fires), firesW);
          const moodText = showMood
            ? inactive
              ? padStart('·', moodW)
              : padStart(
                  `${fmtSigned(r.help)}/${fmtSigned(-r.hurt)}`,
                  moodW,
                )
            : '';
          return (
            <Text key={r.id}>
              <Text color={isFocus ? focusedColor : undefined} bold={isFocus}>
                {isFocus ? '▸ ' : '  '}
              </Text>
              <Text color={dotColor}>● </Text>
              <Text
                color={isFocus ? undefined : inactive ? 'gray' : undefined}
                bold={isFocus}
              >
                {padEnd(r.id, nameW)}
              </Text>
              {showSpark ? (
                <>
                  <Text color={dotColor}>{sparkStr}</Text>
                  <Text>{'  '}</Text>
                </>
              ) : null}
              {showPct ? (
                <>
                  <Text color="gray">{pctText}</Text>
                  <Text>{'  '}</Text>
                </>
              ) : null}
              <Text color={inactive ? 'gray' : undefined}>{firesText}</Text>
              {showMood ? (
                <>
                  <Text>{'  '}</Text>
                  <MoodRun
                    help={r.help}
                    hurt={r.hurt}
                    text={moodText}
                    inactive={inactive}
                  />
                </>
              ) : null}
            </Text>
          );
        })}
      </Box>

      <Box marginTop={1}>
        <Text color="cyan">[↑↓]</Text>
        <Text color="gray"> focus persona</Text>
      </Box>
    </Box>
  );
}

// Render the "+490/-804" mood pair with help in green, hurt in red, and
// the slash in gray · same string the layout reserved space for, just
// colored. For the inactive variant we pass through a single dot.
function MoodRun({
  help,
  hurt,
  text,
  inactive,
}: {
  help: number;
  hurt: number;
  text: string;
  inactive: boolean;
}) {
  if (inactive) {
    return <Text color="gray">{text}</Text>;
  }
  // Recompute pieces so we can color each independently. Leading spaces
  // (from padStart) belong to the green run so alignment is preserved.
  const helpStr = fmtSigned(help);
  const hurtStr = fmtSigned(-hurt);
  const combined = `${helpStr}/${hurtStr}`;
  const leadPad = ' '.repeat(Math.max(0, text.length - combined.length));
  return (
    <Text>
      <Text>{leadPad}</Text>
      <Text color="green">{helpStr}</Text>
      <Text color="gray">/</Text>
      <Text color="red">{hurtStr}</Text>
    </Text>
  );
}
