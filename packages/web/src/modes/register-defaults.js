// Register core optional tickers as adapter Modes on the bus. Player-facing
// game modes were removed; the bus remains useful infrastructure for live
// behavior and panic overlays. The "AI plumbing" cosmetic ticker (tool-call
// hammer, stackoverflow.com RAG tab, hallucination bubbles) was retired
// 2026-05-24, it was wallpaper-comedy that broke the action loop.

import { register, setEnabled, isEnabled } from './bus.js';
import { liveTick, resetLive } from '../live/index.js';
import { tickPanicMoves } from '../live/panic-moves.js';
import { getSetting, onSettingsChange } from '../state/settings.js';

// ---------- live mode ----------
// Wraps liveTick + resetLive. Gated by the 'liveMode' setting; we mirror
// that into the bus's enabled-set whenever it changes so a future Mode-aware
// UI can flip the bus directly without touching settings.
register({
  id: 'live',
  phase: 'physics',
  defaultEnabled: !!getSetting('liveMode'),
  tick(ctx, dt) {
    if (!ctx?.ragdoll) return;
    liveTick(ctx, dt);
  },
  onCharChange() {
    resetLive();
  },
});

// ---------- panic moves ----------
// Always-on per-frame ticker that owns the _active overlay lifecycle for
// the per-persona panic moves. Not user-visible.
register({
  id: 'panic-moves',
  phase: 'physics',
  defaultEnabled: true,
  tick(ctx) {
    if (!ctx?.ragdoll) return;
    tickPanicMoves(ctx);
  },
});

// Bridge: when getSetting('liveMode') flips, sync the bus's 'live' enable
// flag. The actual gating logic still lives in the setting (PR4 migrates
// the settings popover to drive the bus directly).
onSettingsChange((key, val) => {
  if (key !== 'liveMode') return;
  if (!!val !== isEnabled('live')) {
    setEnabled('live', !!val);
  }
});
