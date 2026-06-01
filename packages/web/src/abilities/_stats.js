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
import gift        from './praise/gift.js';
import firstAid    from './praise/first-aid.js';
import defibrillator from './praise/defibrillator.js';
import adrenaline  from './praise/adrenaline.js';

import punch         from './punish/punch.js';
import brassKnuckles from './punish/brass-knuckles.js';
import hammer        from './punish/hammer.js';
import sword         from './punish/lightsaber.js';
import gun           from './punish/gun.js';
import revolver      from './punish/revolver.js';
import machinegun    from './punish/machinegun.js';
import smg           from './punish/smg.js';
import assaultRifle  from './punish/assault-rifle.js';
import lmg           from './punish/lmg.js';
import minigun       from './punish/minigun.js';
import shotgun       from './punish/shotgun.js';
import rocket        from './punish/rocket.js';
import sniperRifle   from './punish/sniper-rifle.js';
import railgun       from './punish/railgun.js';
import fireball      from './punish/fireball.js';
import grenade       from './punish/grenade.js';
import fragGrenade   from './punish/frag-grenade.js';
import flame         from './punish/flame.js';
import lightning     from './punish/lightning.js';
import freeze        from './punish/freeze.js';
import whip          from './punish/whip.js';
import chainsaw      from './punish/chainsaw.js';
import sawblade      from './punish/sawblade.js';
import acidFlask     from './punish/acid-flask.js';
import liquidNitrogen from './punish/liquid-nitrogen.js';
import flashFreeze   from './punish/flash-freeze.js';
import laserCutter   from './punish/laser-cutter.js';
import taser         from './punish/taser.js';

import cannon        from './punish/cannon.js';
import grapeshot     from './punish/grapeshot.js';
import chainShot     from './punish/chain-shot.js';
import hotShot       from './punish/hot-shot.js';
import mortar        from './punish/mortar.js';
import flashbang     from './punish/flashbang.js';
import sonicCannon   from './punish/sonic-cannon.js';
import creepingBarrage from './punish/creeping-barrage.js';

import bat           from './punish/bat.js';
import battleAxe     from './punish/battle_axe.js';
import fireAxe       from './punish/fire_axe.js';
import huntingKnife  from './punish/hunting_knife.js';
import cattleProd    from './punish/cattle_prod.js';
import blowtorch     from './punish/blowtorch.js';
import powerDrill    from './punish/power_drill.js';
import nailGun       from './punish/nail_gun.js';
import caltrops      from './punish/caltrops.js';

import brick        from './siege/brick.js';
import bowlingBall  from './siege/bowling-ball.js';
import piano        from './siege/piano.js';
import crt          from './siege/crt.js';
import car          from './siege/car.js';
import steamroller  from './siege/steamroller.js';
import cityBus      from './siege/city-bus.js';
import trebuchet    from './siege/trebuchet.js';
import officeChair  from './siege/office-chair.js';
import batteringRam from './siege/battering-ram.js';
import wreckingBall from './siege/wrecking-ball.js';
import meteorShower from './siege/meteor-shower.js';
import hailstorm    from './siege/hailstorm.js';

import anvil        from './chaos/anvil.js';
import blackhole    from './chaos/blackhole.js';
import nuke         from './chaos/nuke.js';
import forceQuit    from './chaos/force-quit.js';

import grab        from './cursor/grab.js';
import bearTrap    from './cursor/bear-trap.js';
import meathook    from './cursor/meathook.js';
import magnet      from './cursor/magnet.js';
import landmine    from './cursor/landmine.js';
import cryoMine    from './cursor/cryo-mine.js';
import gasCloud    from './cursor/gas-cloud.js';
import tearGas     from './cursor/tear-gas.js';
import chlorine    from './cursor/chlorine.js';
import cryoFog     from './cursor/cryo-fog.js';
import gravityWell from './cursor/gravity-well.js';
import flood       from './cursor/flood.js';

import electrifiedPanel from './punish/electrified-panel.js';
import buzzsawWall      from './punish/buzzsaw-wall.js';
import subwoofer        from './punish/subwoofer.js';

// Master "stats" slot, cross-tool multipliers live here. Master tree nodes
// mutate this and individual abilities can opt-in to read e.g. masterStats.moodMul.
const MASTER_DEFAULTS = {
  moodMul:        1,    // multiplier on positive mood deltas
  damageMul:      1,    // multiplier on negative mood deltas
  shakeMul:       1,    // multiplier on screenShake intensity
  earnMul:        1,    // multiplier on currency earn
  comboBonusMul:  1,    // bonus currency on combo overlay events
};

// Cross-tool FAMILY stat bags. A `shared` progression node (groups/_shared.js
// sharedNode) flips a behavior FLAG here that every tool in the family reads
// at runtime — e.g. `firearms.aimbot` turns auto-targeting from a default into
// a paid unlock. These are BEHAVIOR FLAGS, never scalars (the sharedNode
// validator rejects scalar-only effects). Lives under STATS.fam.<family>.
const FAMILY_DEFAULTS = {
  firearms: { aimbot: false, pierce: false, hollowPoint: false, incendiary: false, he: false },
  ordnance: { shrapnel: false, incendiary: false, doubleTap: false },
  melee:    { flurry: false, bleedOnEdge: false },
  hazard:   { chain: false, rearm: false },
  summons:  { aggression: false },
};

let STATS = null;
let _initialized = false;

// Build the SOURCES object at call time so the import cycle has fully resolved.
function buildSources() {
  return {
    pet, feed, gift, first_aid: firstAid, defibrillator, adrenaline,
    punch, brass_knuckles: brassKnuckles, hammer, sword, gun, revolver, machinegun, smg, assault_rifle: assaultRifle, lmg, minigun, shotgun, rocket, sniper_rifle: sniperRifle, railgun, fireball, grenade, frag_grenade: fragGrenade, flame, lightning, freeze,
    whip, chainsaw, sawblade, acid_flask: acidFlask,
    liquid_nitrogen: liquidNitrogen, flash_freeze: flashFreeze, laser_cutter: laserCutter, taser,
    cannon, grapeshot, chain_shot: chainShot, hot_shot: hotShot, mortar, flashbang, sonic_cannon: sonicCannon, creeping_barrage: creepingBarrage,
    bat, battle_axe: battleAxe, fire_axe: fireAxe, hunting_knife: huntingKnife, cattle_prod: cattleProd, blowtorch, power_drill: powerDrill, nail_gun: nailGun, caltrops,
    brick, bowling_ball: bowlingBall, piano, crt, car, steamroller, city_bus: cityBus, trebuchet, office_chair: officeChair, battering_ram: batteringRam, wrecking_ball: wreckingBall, meteor_shower: meteorShower, hailstorm,
    anvil, blackhole, nuke, force_quit: forceQuit,
    grab, bear_trap: bearTrap, meathook, magnet,
    landmine, electrified_panel: electrifiedPanel, buzzsaw_wall: buzzsawWall, cryo_mine: cryoMine,
    gas_cloud: gasCloud, tear_gas: tearGas, chlorine, cryo_fog: cryoFog, subwoofer,
    gravity_well: gravityWell, flood,
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
  STATS.fam = {};
  for (const [family, defaults] of Object.entries(FAMILY_DEFAULTS)) {
    STATS.fam[family] = structuredClone(defaults);
  }
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

// Cross-tool family behavior-flag bag (see FAMILY_DEFAULTS). Abilities read
// this inside apply() (live binding) the same way they read getStats(id).
export function getFamilyStats(family) {
  ensureInit();
  return STATS.fam[family] || (STATS.fam[family] = {});
}

export function getAllStats() {
  ensureInit();
  return STATS;
}
