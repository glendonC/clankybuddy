// Ability registry. Each ability module exports a default object with
//   { id, apply?(ctx), applyRelease?(ctx) }.
// The TOOLS table in ui.js remains the single source of truth for everything
// UI/input cares about (label, key, kind, delta, section, blurb, cd). This
// registry owns the runtime contract. They are matched by `id`.

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

import { TOOLS_BY_ID } from '../ui/tools-table.js';
import { removeStatus, hasStatus, getStatus } from '../effects/registry.js';
import { getCurrentBuddy } from '../state/ragdoll-lifecycle.js';
import { maybeFireSoraWave } from '../modes/events.js';

const ABILITIES = {
  pet, feed, compliment, gift, gpu,
  punch, hammer, sword, gun, machinegun, shotgun, rocket, fireball, grenade, flame, lightning, freeze,
  mode_collapse: modeCollapse, gaslight,
  whip, chainsaw, sawblade,
  anvil, blackhole, nuke, force_quit: forceQuit,
  grab, bear_trap: bearTrap, meathook,
};

// flame.js exports id 'flamethrower'; gpu.js id 'gpu'; etc. The variable name
// above is just for readability, keys here are tool ids.
const ABILITIES_BY_ID = {};
for (const a of Object.values(ABILITIES)) ABILITIES_BY_ID[a.id] = a;

export function getAbility(id) { return ABILITIES_BY_ID[id] || null; }
export function getAllAbilityIds() { return Object.keys(ABILITIES_BY_ID); }

// Groups whose tools count as a "heavy hit" (Phase 4 + Phase 7). Casting
// one of these clears `gaslight.permanent` (the persistent self_loathing
// status) on contact.
const HEAVY_HIT_GROUPS = new Set(['kinetic', 'ordnance', 'cataclysm']);

function maybeClearPermanentGaslight(toolId) {
  const tool = TOOLS_BY_ID[toolId];
  if (!tool || !HEAVY_HIT_GROUPS.has(tool.group)) return;
  const b = getCurrentBuddy();
  if (!b.ragdoll || !b.status) return;
  const rec = getStatus(b.status, b.ragdoll.head, 'self_loathing');
  if (rec?.data?.tier === 'permanent') {
    removeStatus(b.status, b.ragdoll.head, 'self_loathing', 'heavy-hit');
  }
}

export function applyAbility(tool, ctx) {
  maybeClearPermanentGaslight(tool);
  maybeFireSoraWave(tool, ctx);
  const a = ABILITIES_BY_ID[tool];
  if (a?.apply) a.apply(ctx);
}

export function applyDragRelease(tool, ctx) {
  maybeClearPermanentGaslight(tool);
  maybeFireSoraWave(tool, ctx);
  const a = ABILITIES_BY_ID[tool];
  if (a?.applyRelease) a.applyRelease(ctx);
}
