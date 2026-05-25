// Stats modal · three tabs (Overview · Models · Tools), cycled with
// ← →, date window cycled with `r`, focused persona cycled with ↑ ↓
// (Models tab only), personal ↔ global toggled with `g`. Closes on Esc.
//
// This file is the SHELL · it owns state, the data fetch, and key
// dispatch. Every pane / strip / layout helper lives in a sibling
// directory:
//
//   layout/   header, footer, loading + error states, stat grid,
//             intensity legend
//   strips/   calendar heatmap, hour / day / global-lifetime strips
//   panes/    overview, models, tools
//   axis.ts   x/y axis label builders
//   pad.ts    padStart/padEnd/padCenter (TUI-local layout)
//   colors.ts persona chart palette (re-export of PERSONA_BRAND_HEX)
//   types.ts  Tab/ViewMode/FetchState + TABS/WINDOWS constants
//   chart.ts  step-line + sparkline rendering primitives
//   heatmap.ts calendar + time-of-day heatmap data shaping
//
// All rendered widths derive from stdout.columns at render time, so
// terminal resizes immediately reflow the chart and heatmap. Nothing
// is hardcoded to a specific width.

import { Box, useApp, useInput, useStdout } from 'ink';
import { useEffect, useState } from 'react';
import type { MeStatsResponse } from '../../../shared/src/events.js';
import { type ModelId } from '../../../shared/src/personas.js';
import { rankPersonaIds } from '../../../shared/src/stats/index.js';
import type { Config } from '../config.js';
import {
  fetchLeaderboard,
  fetchMeStats,
  parseStatsWindow,
  type StatsWindow,
} from '../me-stats.js';
import { Footer } from './layout/footer.js';
import { Header } from './layout/header.js';
import { ErrorPane, LoadingPane } from './layout/states.js';
import { ModelsPane } from './panes/models.js';
import { OverviewPane } from './panes/overview.js';
import { ToolsPane } from './panes/tools.js';
import {
  TABS,
  WINDOWS,
  type FetchState,
  type Tab,
  type ViewMode,
} from './types.js';

// Re-exported so commands.ts can use the same parser the modal does.
export { parseStatsWindow };

export function StatsView({
  config,
  initialWindow = 'lifetime',
  onClose,
}: {
  config: Config;
  initialWindow?: StatsWindow;
  onClose: () => void;
}) {
  const { stdout } = useStdout();
  const { exit } = useApp();
  const [tab, setTab] = useState<Tab>('overview');
  const [win, setWin] = useState<StatsWindow>(initialWindow);
  const [viewMode, setViewMode] = useState<ViewMode>('personal');
  // Cache keyed by (mode, window) so toggling either axis after first
  // fetch is instant. Two parallel slabs keep the lookups trivial.
  const [cache, setCache] = useState<{
    personal: Partial<Record<StatsWindow, MeStatsResponse>>;
    global: Partial<Record<StatsWindow, MeStatsResponse>>;
  }>({ personal: {}, global: {} });
  const [state, setState] = useState<FetchState>({ kind: 'loading' });
  // Models-tab focus · the chart shows only this persona's curve so
  // distinguishing personas is trivial (no 3-color overlay mush).
  // Default ('claude') is overridden on first render to the top persona
  // by activity, via the auto-correct in ModelsPane.
  const [focusedModel, setFocusedModel] = useState<ModelId>('claude');

  // Fetch when window or mode changes. Cache survives tab switches.
  useEffect(() => {
    const cached = cache[viewMode][win];
    if (cached) {
      setState({ kind: 'ready', data: cached });
      return;
    }
    let cancelled = false;
    setState({ kind: 'loading' });
    const fetcher = viewMode === 'global' ? fetchLeaderboard : fetchMeStats;
    fetcher(config, win)
      .then((data) => {
        if (cancelled) return;
        setCache((prev) => ({
          ...prev,
          [viewMode]: { ...prev[viewMode], [win]: data },
        }));
        setState({ kind: 'ready', data });
      })
      .catch((err) => {
        if (cancelled) return;
        setState({
          kind: 'error',
          message: err instanceof Error ? err.message : String(err),
        });
      });
    return () => {
      cancelled = true;
    };
  }, [win, viewMode, config, cache]);

  useInput((char, key) => {
    if (key.escape || char === 'q') {
      onClose();
      return;
    }
    if (key.ctrl && (char === 'c' || char === 'd')) {
      exit();
      return;
    }
    // On the Models tab, up/down cycle the focused persona in the order
    // shown in the table (rank by fires desc). Elsewhere up/down are
    // unhandled, so this only takes over when it's actually useful.
    if (tab === 'models' && (key.upArrow || key.downArrow)) {
      if (state.kind !== 'ready') return;
      const order = rankPersonaIds(state.data);
      const i = order.indexOf(focusedModel);
      const base = i < 0 ? 0 : i;
      const next = key.upArrow
        ? order[(base - 1 + order.length) % order.length]!
        : order[(base + 1) % order.length]!;
      setFocusedModel(next);
      return;
    }
    if (key.leftArrow || char === 'h') {
      const idx = TABS.findIndex((t) => t.id === tab);
      setTab(TABS[(idx - 1 + TABS.length) % TABS.length]!.id);
      return;
    }
    if (key.rightArrow || char === 'l') {
      const idx = TABS.findIndex((t) => t.id === tab);
      setTab(TABS[(idx + 1) % TABS.length]!.id);
      return;
    }
    if (char === 'r' || char === 'R') {
      const idx = WINDOWS.findIndex((w) => w.id === win);
      setWin(WINDOWS[(idx + 1) % WINDOWS.length]!.id);
      return;
    }
    // Personal ↔ global. Single toggle, not a cycle, so the user can
    // bounce between "me" and "everyone" with no mental overhead.
    if (char === 'g' || char === 'G') {
      setViewMode((m) => (m === 'personal' ? 'global' : 'personal'));
      return;
    }
    // 1/2/3 jump to tab.
    if (char === '1') setTab('overview');
    if (char === '2') setTab('models');
    if (char === '3') setTab('tools');
  });

  const cols = stdout?.columns ?? 80;
  const termRows = stdout?.rows ?? 40;
  // Cap the modal width so it doesn't sprawl across wide terminals · the
  // widest pane (Models chart at 80 cols + axis gutter + paddings) fits
  // comfortably in ~92, so we cap a touch above at 96 and fall back to
  // the terminal width on narrow screens.
  const modalWidth = Math.min(96, cols);
  // Reserve 2 chars padding on each side from the outer border, plus 2
  // from the inner content padding · interior content gets modalWidth-8.
  const interior = Math.max(40, modalWidth - 8);

  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor="gray"
      paddingX={2}
      paddingY={1}
      width={modalWidth}
    >
      <Header tab={tab} viewMode={viewMode} />
      <Box marginTop={1} flexDirection="column">
        {state.kind === 'loading' ? (
          <LoadingPane />
        ) : state.kind === 'error' ? (
          <ErrorPane message={state.message} />
        ) : tab === 'overview' ? (
          <OverviewPane
            data={state.data}
            interior={interior}
            win={win}
            viewMode={viewMode}
          />
        ) : tab === 'models' ? (
          <ModelsPane
            data={state.data}
            interior={interior}
            termRows={termRows}
            win={win}
            focused={focusedModel}
            onFocusChange={setFocusedModel}
          />
        ) : (
          <ToolsPane data={state.data} win={win} />
        )}
      </Box>
      <Footer win={win} viewMode={viewMode} />
    </Box>
  );
}
