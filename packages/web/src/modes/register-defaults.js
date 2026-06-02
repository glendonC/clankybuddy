// Register core optional tickers as adapter Modes on the bus. Player-facing
// game modes were removed; the bus remains useful infrastructure for live
// behavior and panic overlays. The "AI plumbing" cosmetic ticker (tool-call
// hammer, stackoverflow.com RAG tab, hallucination bubbles) was retired
// 2026-05-24, it was wallpaper-comedy that broke the action loop.

import { register, setEnabled, isEnabled } from './bus.js';
import { liveTick, resetLive } from '../live/index.js';
import { tickPanicMoves } from '../live/panic-moves.js';
import { getSetting, onSettingsChange } from '../state/settings.js';
// Force-loop Modes (phase:'physics'). Importing the module runs its
// self-register call on the bus. S5: magnet tractor beam. The gravity well /
// flood are placed/one-shot (not held), so they do NOT use the magnet's
// tool.forceMode mouseup seam: the well ability flips its Mode on and the Mode
// self-disables when no live well bodies remain; the flood's rise/hold/drain
// FSM owns its own OFF.
import './force-magnet.js';
import './force-gravity-well.js';
import './force-flood.js';
// Strafe run: a one-shot swept directional force band. Self-disables when the
// sweep clears the run end (no forceMode mouseup seam — like flood/well, not
// the held magnet/crook), so importing it just self-registers the Mode.
import './force-strafe.js';
// Summons substrate (phase:'physics'): the shared per-frame driver for every
// autonomous hostile summon (Attack dog first). Stateless — dispatches each live
// summon body's _summonTick; the ability flips it on, it self-disables when empty.
import './summons.js';
// B4: cursor-follow Mode (phase:'frame'). Self-registers; stays disabled until a
// consumer (shepherd's crook / marionette) latches a part. The crook's TOOLS row
// declares forceMode:'cursor.follow' so the generic mouseup/tool-switch seam
// disables it (→ teardown → releaseLatch); marionette releases via its timed window.
import './cursor-follow.js';

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
