// Public surface for the cross-package stats helpers. Both the TUI Ink
// modal and the web canvas/DOM dashboard consume this module so the
// data-shaping is identical and the rendering can diverge freely.

export * from './format.js';
export * from './selectors.js';
export * from './bucketing.js';
export * from './streaks.js';
export * from './leaderboard.js';
