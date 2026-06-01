// Ability registry. Each ability module exports a default object with
//   { id, apply?(ctx), applyRelease?(ctx) }.
// The TOOLS table in ui.js remains the single source of truth for everything
// UI/input cares about (label, key, kind, delta, section, blurb, cd). This
// registry owns the runtime contract. They are matched by `id`.

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

import electrifiedPanel from './punish/electrified-panel.js';
import buzzsawWall      from './punish/buzzsaw-wall.js';

import { maybeFireSoraWave } from '../modes/events.js';

const ABILITIES = {
  pet, feed, gift, first_aid: firstAid, defibrillator, adrenaline,
  punch, brass_knuckles: brassKnuckles, hammer, sword, gun, revolver, machinegun, smg, assault_rifle: assaultRifle, lmg, minigun, shotgun, rocket, sniper_rifle: sniperRifle, railgun, fireball, grenade, frag_grenade: fragGrenade, flame, lightning, freeze,
  whip, chainsaw, sawblade, acid_flask: acidFlask,
  liquid_nitrogen: liquidNitrogen, flash_freeze: flashFreeze, laser_cutter: laserCutter, taser,
  cannon, grapeshot, chain_shot: chainShot, hot_shot: hotShot, mortar, flashbang, sonic_cannon: sonicCannon, creeping_barrage: creepingBarrage,
  bat, battle_axe: battleAxe, fire_axe: fireAxe, hunting_knife: huntingKnife, cattle_prod: cattleProd, blowtorch, power_drill: powerDrill, nail_gun: nailGun, caltrops,
  brick, bowling_ball: bowlingBall, piano, crt, car, steamroller, city_bus: cityBus, trebuchet, office_chair: officeChair, battering_ram: batteringRam, wrecking_ball: wreckingBall,
  anvil, blackhole, nuke, force_quit: forceQuit,
  grab, bear_trap: bearTrap, meathook, magnet,
  landmine, electrified_panel: electrifiedPanel, buzzsaw_wall: buzzsawWall, cryo_mine: cryoMine,
};

// flame.js exports id 'flamethrower'; the variable name above is just for
// readability, keys here are tool ids.
const ABILITIES_BY_ID = {};
for (const a of Object.values(ABILITIES)) ABILITIES_BY_ID[a.id] = a;

export function getAbility(id) { return ABILITIES_BY_ID[id] || null; }
export function getAllAbilityIds() { return Object.keys(ABILITIES_BY_ID); }

export function applyAbility(tool, ctx) {
  maybeFireSoraWave(tool, ctx);
  const a = ABILITIES_BY_ID[tool];
  if (a?.apply) a.apply(ctx);
}

export function applyDragRelease(tool, ctx) {
  maybeFireSoraWave(tool, ctx);
  const a = ABILITIES_BY_ID[tool];
  if (a?.applyRelease) a.applyRelease(ctx);
}
