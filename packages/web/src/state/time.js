// Hit-stop: brief engine.timeScale freeze so heavy hits read. scale=0 freezes;
// 0.2 = slow-mo. New hits do not replace a longer running freeze, prevents
// shatter (140ms) from being clobbered by punch (35ms) firing same frame.
//
// Expiry is loop-driven (tickHitStop, called from main.js). setTimeout was
// the original release mechanism but backgrounded tabs throttle setTimeout
// to ≥1s; the unfreeze fired hours late and every subsequent hitStop()
// early-returned because the timestamp was stale. The loop is the only
// reliable clock available to a paused-but-running engine.

import { engine } from './world.js';
import { HIT_STOP } from '../physics/constants.js';

let hitStopUntil = 0;

export function hitStop(ms, scale = 0) {
  const now = performance.now();
  const remaining = Math.max(0, hitStopUntil - now);
  if (ms < remaining) return;
  hitStopUntil = now + ms;
  engine.timing.timeScale = scale;
}

/** Loop-driven release. Call once per render frame from main.js. */
export function tickHitStop(now = performance.now()) {
  if (!hitStopUntil) return;
  if (now < hitStopUntil) return;
  engine.timing.timeScale = 1;
  hitStopUntil = 0;
}

// Tier shortcuts, abilities prefer these to raw (ms, scale). Tier values
// live in physics/constants.js so the table is shared between the helper
// and any future linting / migration tooling.
hitStop.light     = () => hitStop(HIT_STOP.light.ms,     HIT_STOP.light.scale);
hitStop.heavy     = () => hitStop(HIT_STOP.heavy.ms,     HIT_STOP.heavy.scale);
hitStop.shatter   = () => hitStop(HIT_STOP.shatter.ms,   HIT_STOP.shatter.scale);
hitStop.projSmall = () => hitStop(HIT_STOP.projSmall.ms, HIT_STOP.projSmall.scale);
hitStop.projBig   = () => hitStop(HIT_STOP.projBig.ms,   HIT_STOP.projBig.scale);
hitStop.explosion = () => hitStop(HIT_STOP.explosion.ms, HIT_STOP.explosion.scale);
hitStop.mega      = () => hitStop(HIT_STOP.mega.ms,      HIT_STOP.mega.scale);
