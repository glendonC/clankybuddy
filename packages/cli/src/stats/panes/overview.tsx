// Overview tab · activity strip on top, two-column stat tile grid below.
// Layout differs by mode:
//   personal · narrative starts with "your" favorites, leans on records
//              (longest combo / session, biggest help / hurt).
//   global   · "Top model" and "Top tool" instead of "Favorite"; records
//              and streaks are personal-only so we drop them and lead
//              with raw global volume + help/hurt balance.
//   24h day  · drops multi-day-only stats (streaks, active days,
//              most-active-day) regardless of mode.

import { Box } from 'ink';
import type { MeStatsResponse } from '../../../../shared/src/events.js';
import {
  computeStreaks,
  fmtDuration,
  fmtInt,
  fmtShortDateIso,
  fmtSigned,
  pickFavoriteModel,
  pickFavoriteVerb,
  pickMostActiveDay,
} from '../../../../shared/src/stats/index.js';
import type { StatsWindow } from '../../me-stats.js';
import { StatGrid } from '../layout/stat-grid.js';
import { CalendarHeatmap } from '../strips/calendar-heatmap.js';
import { DayStrip } from '../strips/day-strip.js';
import { GlobalLifetimeStrip } from '../strips/global-lifetime-strip.js';
import { HourStrip } from '../strips/hour-strip.js';
import type { ViewMode } from '../types.js';

export function OverviewPane({
  data,
  interior,
  win,
  viewMode,
}: {
  data: MeStatsResponse;
  interior: number;
  win: StatsWindow;
  viewMode: ViewMode;
}) {
  const isGlobal = viewMode === 'global';
  const favoriteModel = pickFavoriteModel(data);
  const favoriteAbility = pickFavoriteVerb(data);
  const mostActiveDayEntry = isGlobal ? null : pickMostActiveDay(data);
  const mostActiveDay = mostActiveDayEntry
    ? fmtShortDateIso(mostActiveDayEntry.date)
    : null;
  const activeDays = (data.daily_calendar ?? []).filter(
    (d) => (d.fires ?? 0) + (d.hits ?? 0) > 0,
  ).length;
  const { longest_streak, current_streak } = computeStreaks(
    data.daily_calendar ?? [],
  );

  type Row = ReadonlyArray<readonly [string, string]>;
  const dayCountLabel = (n: number) => `${n} day${n === 1 ? '' : 's'}`;
  const netMood = fmtSigned(data.totals.help_mood - data.totals.hurt_mood);

  let statRows: Row[];
  if (isGlobal) {
    // Global mode · totals + balance only. Records/sessions/streaks are
    // per-user concepts the leaderboard doesn't carry.
    statRows = [
      [
        ['Top model', favoriteModel ?? '—'],
        ['Top tool', favoriteAbility ?? '—'],
      ],
      [
        ['Global actions', fmtInt(data.totals.fires)],
        ['Total help', fmtSigned(data.totals.help_mood)],
      ],
      [
        ['Total hurt', fmtSigned(-data.totals.hurt_mood)],
        ['Net mood', netMood],
      ],
    ];
  } else {
    const commonRows: Row[] = [
      [
        ['Favorite model', favoriteModel ?? '—'],
        ['Favorite tool', favoriteAbility ?? '—'],
      ],
      [
        ['Total actions', fmtInt(data.totals.fires)],
        ['Total hits', fmtInt(data.totals.hits)],
      ],
      [
        ['Sessions', fmtInt(data.totals.sessions)],
        ['Longest session', fmtDuration(data.records.longest_session_ms)],
      ],
    ];
    const longestComboCell: readonly [string, string] = [
      'Longest combo',
      `${fmtInt(data.records.longest_combo)} hits`,
    ];
    // Records row · biggest help / hurt session were previously
    // unsurfaced. Short labels so the StatGrid doesn't outgrow the
    // modal interior · the "session" qualifier is implied by the
    // surrounding panel.
    const biggestRow: Row = [
      ['Biggest help', fmtSigned(data.records.biggest_session_help)],
      ['Biggest hurt', fmtSigned(-data.records.biggest_session_hurt)],
    ];
    statRows = win === 'day'
      ? [
          ...commonRows,
          [longestComboCell, ['Net mood', netMood]],
          biggestRow,
        ]
      : [
          ...commonRows,
          [
            longestComboCell,
            ['Active days', `${activeDays} / ${win === 'week' ? 7 : 365}`],
          ],
          biggestRow,
          [
            ['Current streak', dayCountLabel(current_streak)],
            ['Best streak', dayCountLabel(longest_streak)],
          ],
          ...(mostActiveDay
            ? ([[
                ['Most active day', mostActiveDay] as readonly [string, string],
                ['Net mood', netMood] as readonly [string, string],
              ]] as Row[])
            : []),
        ];
  }

  return (
    <Box flexDirection="column">
      {/* Activity strip · dispatch on window. The calendar grid only
          makes sense at multi-week scale; for short windows we use a
          horizontal strip matching the natural unit (hour or day). In
          global mode the calendar would be empty (daily_calendar is
          per-user), so we render a timeseries-derived bar strip
          instead. */}
      {win === 'day' ? (
        <HourStrip data={data} />
      ) : win === 'week' ? (
        <DayStrip data={data} />
      ) : isGlobal ? (
        <GlobalLifetimeStrip data={data} interior={interior} />
      ) : (
        <CalendarHeatmap data={data} interior={interior} />
      )}

      <Box marginTop={1} flexDirection="column">
        <StatGrid rows={statRows} interior={interior} />
      </Box>
    </Box>
  );
}
