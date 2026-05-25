// Mutable per-tool stats singleton. Each ability module exports `defaultStats`;
// _stats.js clones those into the live STATS table, and progression/apply-upgrades.js
// rebuilds + walks the unlocked node set to mutate STATS at boot and on each
// purchase.
//
// CYCLE NOTE: this file imports every ability, and every ability imports
// `getStats` from this file. ES module live bindings make function-call-time
// references safe, but a top-level `const SOURCES = { punch, ... }` literal
// would synchronously read those bindings *during* the import cycle and trip
// a TDZ, by the time _stats.js evaluates its body, the ability that triggered
// the cycle is still mid-load. So we build SOURCES lazily inside resetStats()
// instead of as a top-level const. resetStats() is only called by
// apply-upgrades.bootstrap() (after all imports complete) and by getStats()
// when called for the first time.

import pet         from './praise/pet.js';
import feed        from './praise/feed.js';
import compliment  from './praise/compliment.js';
import gift        from './praise/gift.js';
import gpu         from './praise/gpu.js';

import punch         from './punish/punch.js';
import hammer        from './punish/hammer.js';
import sword         from './punish/lightsaber.js';
import gun           from './punish/gun.js';
import machinegun    from './punish/machinegun.js';
import shotgun       from './punish/shotgun.js';
import rocket        from './punish/rocket.js';
import fireball      from './punish/fireball.js';
import grenade       from './punish/grenade.js';
import flame         from './punish/flame.js';
import lightning     from './punish/lightning.js';
import freeze        from './punish/freeze.js';
import modeCollapse  from './punish/mode-collapse.js';
import gaslight      from './punish/gaslight.js';
import whip          from './punish/whip.js';
import chainsaw      from './punish/chainsaw.js';
import sawblade      from './punish/sawblade.js';

import anvil        from './chaos/anvil.js';
import blackhole    from './chaos/blackhole.js';
import nuke         from './chaos/nuke.js';
import forceQuit    from './chaos/force-quit.js';

import grab        from './cursor/grab.js';
import bearTrap    from './cursor/bear-trap.js';
import meathook    from './cursor/meathook.js';

// Master "stats" slot, cross-tool multipliers live here. Master tree nodes
// mutate this and individual abilities can opt-in to read e.g. masterStats.moodMul.
const MASTER_DEFAULTS = {
  moodMul:        1,    // multiplier on positive mood deltas
  damageMul:      1,    // multiplier on negative mood deltas
  shakeMul:       1,    // multiplier on screenShake intensity
  earnMul:        1,    // multiplier on currency earn
  comboBonusMul:  1,    // bonus currency on combo overlay events
};

let STATS = null;
let _initialized = false;

// Build the SOURCES object at call time so the import cycle has fully resolved.
function buildSources() {
  return {
    pet, feed, compliment, gift, gpu,
    punch, hammer, sword, gun, machinegun, shotgun, rocket, fireball, grenade, flame, lightning, freeze,
    mode_collapse: modeCollapse, gaslight,
    whip, chainsaw, sawblade,
    anvil, blackhole, nuke, force_quit: forceQuit,
    grab, bear_trap: bearTrap, meathook,
  };
}

export function resetStats() {
  const sources = buildSources();
  STATS = {};
  for (const [name, mod] of Object.entries(sources)) {
    // Look up by the *exported id* not the variable name (sword vs lightsaber, flame vs flamethrower).
    const key = mod?.id || name;
    STATS[key] = mod && mod.defaultStats ? structuredClone(mod.defaultStats) : {};
  }
  STATS.master = structuredClone(MASTER_DEFAULTS);
  _initialized = true;
}

function ensureInit() {
  if (!_initialized) resetStats();
}

export function getStats(id) {
  ensureInit();
  return STATS[id] || (STATS[id] = {});
}

export function getMasterStats() {
  ensureInit();
  return STATS.master;
}

export function getAllStats() {
  ensureInit();
  return STATS;
}
