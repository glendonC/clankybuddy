// Ability registry. Each ability module exports a default object with
//   { id, apply?(ctx), applyRelease?(ctx) }.
// The TOOLS table in ui.js remains the single source of truth for everything
// UI/input cares about (label, key, kind, delta, section, blurb, cd). This
// registry owns the runtime contract. They are matched by `id`.

import pet         from './praise/pet.js';
import feed        from './praise/feed.js';
import gift        from './praise/gift.js';
import firstAid    from './praise/first-aid.js';

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
import fireball      from './punish/fireball.js';
import grenade       from './punish/grenade.js';
import fragGrenade   from './punish/frag-grenade.js';
import flame         from './punish/flame.js';
import lightning     from './punish/lightning.js';
import freeze        from './punish/freeze.js';
import whip          from './punish/whip.js';
import chainsaw      from './punish/chainsaw.js';
import sawblade      from './punish/sawblade.js';

import brick        from './siege/brick.js';
import bowlingBall  from './siege/bowling-ball.js';
import piano        from './siege/piano.js';

import anvil        from './chaos/anvil.js';
import blackhole    from './chaos/blackhole.js';
import nuke         from './chaos/nuke.js';
import forceQuit    from './chaos/force-quit.js';

import grab        from './cursor/grab.js';
import bearTrap    from './cursor/bear-trap.js';
import meathook    from './cursor/meathook.js';

import { maybeFireSoraWave } from '../modes/events.js';

const ABILITIES = {
  pet, feed, gift, first_aid: firstAid,
  punch, brass_knuckles: brassKnuckles, hammer, sword, gun, revolver, machinegun, smg, assault_rifle: assaultRifle, lmg, minigun, shotgun, rocket, fireball, grenade, frag_grenade: fragGrenade, flame, lightning, freeze,
  whip, chainsaw, sawblade,
  brick, bowling_ball: bowlingBall, piano,
  anvil, blackhole, nuke, force_quit: forceQuit,
  grab, bear_trap: bearTrap, meathook,
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
