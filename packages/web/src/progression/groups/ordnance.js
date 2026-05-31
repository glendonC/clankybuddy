// Ordnance group tree (renamed from `ranged` in Phase 1 of the 2026-05-02
// ability redesign, see docs/abilities.md). Pistol is the entry-tier
// root; everything else branches off it (machinegun + shotgun + rocket
// + grenade).

import { toolNode, statNode, sharedNode } from './_shared.js';

export default [
  // Root: pistol
  toolNode({
    id: 'g.ordnance.gun', parents: [], cost: 75, toolId: 'gun',
    label: 'pistol',
    blurb: 'One-shot pistol, fast aim, light damage.',
  }),
  statNode({
    id: 'g.ordnance.gun.dmg', parents: ['g.ordnance.gun'], cost: 150, toolId: 'gun',
    label: 'JHP rounds',
    blurb: 'Damage 10 → 15.',
    effect: (s) => { s.damage = 15; },
  }),
  statNode({
    id: 'g.ordnance.gun.speed', parents: ['g.ordnance.gun'], cost: 150, toolId: 'gun',
    label: 'Hot loads',
    blurb: 'Bullet speed 22 → 30. Less drop, faster impact.',
    effect: (s) => { s.speed = 30; },
  }),

  // Revolver, six heavy shots + forced reload (branches off pistol).
  toolNode({
    id: 'g.ordnance.revolver', parents: ['g.ordnance.gun'], cost: 140, toolId: 'revolver',
    label: 'revolver',
    blurb: 'Six heavy magnum shots with big stun, then a forced reload.',
  }),

  // SHARED (cross-tool, family: firearms). Targeting computer turns auto-aim
  // from the old always-on default into a paid unlock: every firearm now aims
  // MANUALLY (fires at the buddy's centroid, no lock) until you buy this, at
  // which point they snap to the nearest part + show the lock-on reticle.
  // Behavior flag only — no scalar — per the sharedNode guard.
  sharedNode({
    id: 'g.ordnance.aimbot', parents: ['g.ordnance.gun'], cost: 250,
    family: 'firearms', flag: 'aimbot',
    label: 'Targeting computer',
    iconHint: '◎',
    blurb: 'Every firearm auto-locks the nearest part (aimbot). Without it, you aim by hand.',
    effect: (fam) => { fam.aimbot = true; },
  }),

  // SHARED ammo mods (cross-tool, family: firearms). Each flips a behavior
  // flag the bullet handler reads, so it upgrades EVERY firearm's rounds at
  // once. Behavior flags only — no scalars — per the sharedNode guard.
  sharedNode({
    id: 'g.ordnance.hollowpoint_rounds', parents: ['g.ordnance.gun'], cost: 350,
    family: 'firearms', flag: 'hollowPoint',
    label: 'Hollow-point rounds',
    blurb: 'Every firearm round opens a BLEED on hit.',
    effect: (fam) => { fam.hollowPoint = true; },
  }),
  sharedNode({
    id: 'g.ordnance.incendiary_rounds', parents: ['g.ordnance.gun'], cost: 350,
    family: 'firearms', flag: 'incendiary',
    label: 'Incendiary rounds',
    blurb: 'Every firearm round sets the struck part ON FIRE.',
    effect: (fam) => { fam.incendiary = true; },
  }),
  sharedNode({
    id: 'g.ordnance.he_rounds', parents: ['g.ordnance.gun'], cost: 500,
    family: 'firearms', flag: 'he',
    label: 'HE rounds',
    blurb: 'Every firearm round detonates a small high-explosive burst on impact.',
    effect: (fam) => { fam.he = true; },
  }),

  // Machinegun branch (sustained DPS)
  toolNode({
    id: 'g.ordnance.machinegun', parents: ['g.ordnance.gun'], cost: 100, toolId: 'machinegun',
    label: 'machine gun',
    blurb: 'Spray bullets, sustained DPS.',
  }),
  // SMG, mobile bullet-hose with a blooming cone (branches off machine gun).
  toolNode({
    id: 'g.ordnance.smg', parents: ['g.ordnance.machinegun'], cost: 130, toolId: 'smg',
    label: 'smg',
    blurb: 'Faster, lighter rounds; accuracy blooms wider the longer you hold.',
  }),
  // Assault rifle, recoil-climbing auto (branches off machine gun).
  toolNode({
    id: 'g.ordnance.assault_rifle', parents: ['g.ordnance.machinegun'], cost: 180, toolId: 'assault_rifle',
    label: 'assault rifle',
    blurb: 'Higher-damage auto; the cone climbs with recoil, reward burst discipline.',
  }),
  // LMG, belt-fed spin-up suppression (branches off machine gun).
  toolNode({
    id: 'g.ordnance.lmg', parents: ['g.ordnance.machinegun'], cost: 260, toolId: 'lmg',
    label: 'lmg',
    blurb: 'Spins up from weak to a wall of lead the longer you hold.',
  }),
  // Minigun, locked-barrel evolve of the LMG.
  toolNode({
    id: 'g.ordnance.minigun', parents: ['g.ordnance.lmg'], cost: 400, toolId: 'minigun',
    label: 'minigun',
    blurb: 'Fastest fire rate in the game; the barrel locks where you opened up.',
  }),
  statNode({
    id: 'g.ordnance.machinegun.rate', parents: ['g.ordnance.machinegun'], cost: 300, toolId: 'machinegun',
    label: 'High RPM',
    blurb: 'Bullet damage 1.5 → 2.5. Wall of lead.',
    effect: (s) => { s.damage = 2.5; },
  }),
  statNode({
    id: 'g.ordnance.machinegun.choke', parents: ['g.ordnance.machinegun'], cost: 300, toolId: 'machinegun',
    label: 'Tight choke',
    blurb: 'Spread 0.12 → 0.06. Tighter cone, more headshots.',
    effect: (s) => { s.spread = 0.06; },
  }),
  statNode({
    id: 'g.ordnance.machinegun.minigun', parents: ['g.ordnance.machinegun.rate', 'g.ordnance.machinegun.choke'], cost: 1200, toolId: 'machinegun',
    label: 'Overspin',
    iconHint: '⚡',
    blurb: 'Machine-gun damage +60%, speed 26 → 36. (Node id kept for save compat; the standalone minigun is its own tool now.)',
    effect: (s) => { s.damage *= 1.6; s.speed = 36; },
  }),

  // Shotgun branch (burst)
  toolNode({
    id: 'g.ordnance.shotgun', parents: ['g.ordnance.gun'], cost: 120, toolId: 'shotgun',
    label: 'shotgun',
    blurb: 'Close-range cone, massive knockback, falls off with distance.',
  }),
  statNode({
    id: 'g.ordnance.shotgun.pellets', parents: ['g.ordnance.shotgun'], cost: 300, toolId: 'shotgun',
    label: 'More pellets',
    blurb: 'Pellets 9 → 14. The whole part disappears.',
    effect: (s) => { s.pellets = 14; },
  }),
  statNode({
    id: 'g.ordnance.shotgun.slug', parents: ['g.ordnance.shotgun'], cost: 1200, toolId: 'shotgun',
    label: 'Slug round',
    iconHint: '⚡',
    blurb: 'One huge pellet, massive mood damage, tighter spread.',
    // Phase 7, `s.damage` doesn't exist in shotgun's defaultStats (uses
    // `s.mood`); the old mutation was a dead-write. Tightening cone matches
    // the "single projectile" intent. force exists in defaultStats.
    effect: (s) => { s.pellets = 1; s.force *= 4; s.mood *= 3; s.coneRad = 0.05; },
  }),

  // Explosives sub-tree (lobbed + dropped). Mortar is now the ROOT (Phase 3
  // re-root); frag grenade hangs off it and molotov off frag. Creeping barrage /
  // cluster / airstrike / breaching are deferred to later batches.
  toolNode({
    id: 'g.ordnance.mortar', parents: [], cost: 210, toolId: 'mortar',
    label: 'mortar',
    blurb: 'Mark the ground; a shell whistles in from above and detonates.',
  }),
  statNode({
    id: 'g.ordnance.mortar.shell', parents: ['g.ordnance.mortar'], cost: 500, toolId: 'mortar',
    label: 'Bigger shell',
    blurb: 'Blast radius 240 → 340, mood damage +40%.',
    effect: (s) => { s.radius = 340; s.mood = Math.round(s.mood * 1.4); },
  }),
  toolNode({
    id: 'g.ordnance.frag_grenade', parents: ['g.ordnance.mortar'], cost: 150, toolId: 'frag_grenade',
    label: 'frag grenade',
    blurb: 'Drag to lob, 2s fuse, dry blast + a radial spray of shrapnel.',
  }),
  toolNode({
    id: 'g.ordnance.grenade', parents: ['g.ordnance.frag_grenade'], cost: 120, toolId: 'grenade',
    label: 'molotov',
    blurb: 'Drag to lob, 2s fuse, area boom + lingering fire pool.',
  }),

  // Rocket branch (flagship boom)
  toolNode({
    id: 'g.ordnance.rocket', parents: ['g.ordnance.gun'], cost: 200, toolId: 'rocket',
    label: 'rocket',
    blurb: 'Straight-line projectile + huge splash.',
  }),
  statNode({
    id: 'g.ordnance.rocket.warhead', parents: ['g.ordnance.rocket'], cost: 600, toolId: 'rocket',
    label: 'Bigger warhead',
    blurb: 'Radius 260 → 360, force ×1.6.',
    effect: (s) => { s.radius = 360; s.force *= 1.6; s.mood = Math.round(s.mood * 1.5); },
  }),
  statNode({
    id: 'g.ordnance.rocket.cluster', parents: ['g.ordnance.rocket.warhead'], cost: 1200, toolId: 'rocket',
    label: 'Inferno warhead',
    iconHint: '⚡',
    // Phase 7, relabeled from "Cluster warhead." The original name promised
    // sub-munitions; the implementation only ships radius bump + longer
    // burn, so the name was a check the code couldn't cash. Inferno fits.
    blurb: 'Bigger radius, longer burn (4s), the whole stage shakes.',
    effect: (s) => { s.radius *= 1.2; s.igniteMs = 4000; },
  }),

  // Cannon branch (player-aimed heavy projectile; family: firearms). Independent
  // root; grapeshot / chain shot / hot shot fork off it.
  toolNode({
    id: 'g.ordnance.cannon', parents: [], cost: 160, toolId: 'cannon',
    label: 'cannon',
    blurb: 'Emplaced cannon: fires a heavy iron ball along your aim line. Pure crushing impact.',
  }),
  statNode({
    id: 'g.ordnance.cannon.bigger_ball', parents: ['g.ordnance.cannon'], cost: 350, toolId: 'cannon',
    label: 'Heavier ball',
    blurb: 'Ball radius 11 → 15, blast radius 120 → 150, mood 40 → 50.',
    effect: (s) => { s.ballRadius = 15; s.radius = 150; s.mood = 50; },
  }),
  toolNode({
    id: 'g.ordnance.grapeshot', parents: ['g.ordnance.cannon'], cost: 200, toolId: 'grapeshot',
    label: 'grapeshot',
    blurb: 'One trigger pull scatters a tight forward cone of iron shot. Composes with firearms ammo mods.',
  }),
  toolNode({
    id: 'g.ordnance.chain_shot', parents: ['g.ordnance.cannon'], cost: 230, toolId: 'chain_shot',
    label: 'chain shot',
    blurb: 'Two linked balls fly as a parallel pair and clothesline anything caught between them.',
  }),
  toolNode({
    id: 'g.ordnance.hot_shot', parents: ['g.ordnance.cannon'], cost: 260, toolId: 'hot_shot',
    label: 'hot shot',
    blurb: 'A furnace-heated cannonball: sets the buddy alight on impact and leaves a pool of burning embers.',
  }),

  // Concussive branch (flashbang root → sonic cannon). The first RANGED CONCUSSED
  // applicators (the status existed; nothing applied it at range until now).
  toolNode({
    id: 'g.ordnance.flashbang', parents: [], cost: 160, toolId: 'flashbang',
    label: 'flashbang',
    blurb: 'Drag to lob, 2s fuse, blinding flash that concusses everything nearby.',
  }),
  toolNode({
    id: 'g.ordnance.sonic_cannon', parents: ['g.ordnance.flashbang'], cost: 190, toolId: 'sonic_cannon',
    label: 'sonic cannon',
    blurb: 'Instant aimed cone; shoves and concusses every part it sweeps.',
  }),

  // Lightning branch, sky bolt + chains. Joined ordnance in Phase 2
  // (was in `corruption` while the group was still called `elemental`).
  // Independent root, sits parallel to the pistol chain, since it's an
  // unlock you take instead of branching off pistol stat-tunes.
  toolNode({
    id: 'g.ordnance.lightning', parents: [], cost: 250, toolId: 'lightning',
    label: 'lightning',
    blurb: 'Sky bolt + branching forks. Pairs with ice (CONDUCT) and fire (COMBUST).',
  }),
  statNode({
    id: 'g.ordnance.lightning.chains', parents: ['g.ordnance.lightning'], cost: 600, toolId: 'lightning',
    label: 'More chains',
    blurb: 'Chain targets 3 → 5, fork chance 0.55 → 0.75.',
    effect: (s) => { s.chainTargets = 5; s.forkChance = 0.75; },
  }),
  statNode({
    id: 'g.ordnance.lightning.zeus', parents: ['g.ordnance.lightning.chains'], cost: 1200, toolId: 'lightning',
    label: 'Zeus',
    iconHint: '⚡',
    blurb: 'Mood damage +50%, electrified duration doubles.',
    effect: (s) => { s.mood = Math.round(s.mood * 1.5); s.electrifiedMs *= 2; s.shake = 28; },
  }),

  // Saw blade (Phase 7, gore add). Click-throw a spinning disc that
  // ricochets off walls until it bites. Pure impact damage, bleed lives
  // on chainsaw / bear-trap / meathook, sawblade owns the bounce.
  toolNode({
    id: 'g.ordnance.sawblade', parents: ['g.ordnance.gun'], cost: 180, toolId: 'sawblade',
    label: 'saw blade',
    blurb: 'Spinning disc ricochets off walls until it bites.',
  }),
  statNode({
    id: 'g.ordnance.sawblade.edge', parents: ['g.ordnance.sawblade'], cost: 350, toolId: 'sawblade',
    label: 'Toothed edge',
    blurb: 'Damage 12 → 18. Heavier impact + knockback.',
    effect: (s) => { s.damage = 18; },
  }),
  statNode({
    id: 'g.ordnance.sawblade.lodge', parents: ['g.ordnance.sawblade.edge'], cost: 1000, toolId: 'sawblade',
    label: 'Lodge',
    iconHint: '⚡',
    blurb: 'A1, 30% chance the disc embeds in the part on hit and ticks BLEED for 1.5s before falling out (PR5 consumer reads lodgeChance/lodgeBleedMs).',
    effect: (s) => { s.lodgeChance = 0.3; s.lodgeBleedMs = 1500; },
  }),
  statNode({
    id: 'g.ordnance.sawblade.spin', parents: ['g.ordnance.sawblade'], cost: 350, toolId: 'sawblade',
    label: 'Hot rotor',
    blurb: 'Disc lifetime 1400 → 2200ms, more ricochets per cast.',
    effect: (s) => { s.lifeMs = 2200; },
  }),
  statNode({
    id: 'g.ordnance.sawblade.possessed', parents: ['g.ordnance.sawblade.spin'], cost: 1000, toolId: 'sawblade',
    label: 'Possessed Disc',
    iconHint: '⚡',
    blurb: 'B1, Lifetime 2200 → 4000ms. On each wall-bounce, gently homes toward the nearest part (5°/bounce). Feels haunted (PR5 consumer reads bounceHomingDeg).',
    effect: (s) => { s.lifeMs = 4000; s.bounceHomingDeg = 5; },
  }),
];
