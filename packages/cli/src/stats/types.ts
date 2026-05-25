// Shared types and constants for the stats modal. Pulled out of view.tsx
// during the modularization refactor so individual pane/layout/strip
// files don't have to circular-import the shell.

import type { MeStatsResponse } from '../../../shared/src/events.js';
import type { StatsWindow } from '../me-stats.js';

// "personal" = /me/stats, "global" = /leaderboard reshaped via
// shared/stats/leaderboard.ts. Same renderers consume both.
export type ViewMode = 'personal' | 'global';

// Three modal tabs · cycled with ← → or 1/2/3.
export type Tab = 'overview' | 'models' | 'tools';

export const TABS: { id: Tab; label: string }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'models', label: 'Models' },
  { id: 'tools', label: 'Tools' },
];

// Window selector · cycled with `r`. Order is "biggest scope first" so
// landing on the modal puts the most context in front of the user.
export const WINDOWS: { id: StatsWindow; label: string }[] = [
  { id: 'lifetime', label: 'All time' },
  { id: 'week', label: 'Last 7 days' },
  { id: 'day', label: 'Last 24h' },
];

// Fetch state for the modal's data pipeline. `data` is a MeStatsResponse
// even when viewMode='global' · the reshape happens at the API edge.
export type FetchState =
  | { kind: 'loading' }
  | { kind: 'ready'; data: MeStatsResponse }
  | { kind: 'error'; message: string };
