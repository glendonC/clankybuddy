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

  // Sniper rifle, slow heavy round that drills through a LINE of parts (first
  // pierce_bullet consumer; branches off pistol). Hold-breath charge shot +
  // Anti-materiel (convergent with armor-piercing rounds) land with the
  // armor-piercing batch that wires fam.pierce into every firearm.
  toolNode({
    id: 'g.ordnance.sniper_rifle', parents: ['g.ordnance.gun'], cost: 240, toolId: 'sniper_rifle',
    label: 'sniper rifle',
    blurb: 'A long-barreled bolt-action; one high-velocity round drills clean through a line of parts.',
  }),
  statNode({
    id: 'g.ordnance.sniper_rifle.match', parents: ['g.ordnance.sniper_rifle'], cost: 300, toolId: 'sniper_rifle',
    label: 'Match ammo',
    blurb: 'Damage 28 → 38, round speed 32 → 42.',
    effect: (s) => { s.damage = 38; s.speed = 42; },
  }),
  // Convergent merge: needs the sniper rifle AND armor-piercing rounds. Both
  // parents are g.ordnance.* so the cross-group validator passes; shared nodes
  // live in NODES_BY_ID so ap_rounds is a valid parent.
  statNode({
    id: 'g.ordnance.sniper_rifle.anti_materiel', parents: ['g.ordnance.sniper_rifle', 'g.ordnance.ap_rounds'], cost: 700, toolId: 'sniper_rifle',
    label: 'Anti-materiel rifle',
    blurb: 'Pierce 2 → 3, and any frozen limb the slug crosses shatters clean off. Needs the sniper rifle + armor-piercing rounds.',
    effect: (s) => { s.pierce = 3; s.pierceShatter = true; },
  }),

  // Hold-breath charge shot <- sniper rifle. A kind:'drag' charge fork: hold to
  // build the PIERCE BUDGET of one natively-spawned pierce_bullet — a snap is
  // pierce 1 (single drill), a full charge is pierce 4 (a whole-body line-clear).
  // The charge modulates the same pierce axis that separates handgun/sniper/
  // railgun, so it's a player-controlled verb, not a damage scalar. Leaves cash
  // distinct reads: Bipod → s.chargeMs (charge tempo); Heavy barrel → s.pierceMax
  // (line depth) + s.dmgMax (the c=1 ceiling).
  toolNode({
    id: 'g.ordnance.charge_shot', parents: ['g.ordnance.sniper_rifle'], cost: 360, toolId: 'charge_shot',
    label: 'hold-breath charge shot',
    blurb: 'Hold to steady your breath: a quick tap drills one limb, a full charge punches a heavy slug clean through the whole line.',
  }),
  statNode({
    id: 'g.ordnance.charge_shot.bipod', parents: ['g.ordnance.charge_shot'], cost: 320, toolId: 'charge_shot',
    label: 'Bipod',
    blurb: 'A folding bipod steadies your aim: full charge in 0.9s → 0.6s, so you reach a line-clearing shot faster.',
    effect: (s) => { s.chargeMs = 600; },
  }),
  statNode({
    id: 'g.ordnance.charge_shot.heavy_barrel', parents: ['g.ordnance.charge_shot.bipod'], cost: 520, toolId: 'charge_shot',
    label: 'Heavy barrel',
    iconHint: '⚡',
    blurb: 'A long bull barrel: a full charge now drills six limbs (pierce 4 → 6) and hits harder (46 → 60).',
    effect: (s) => { s.pierceMax = 6; s.dmgMax = 60; },
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
  // Armor-piercing rounds — flips firearms.pierce. Single-shot firearm rounds
  // spawn as pierce_bullet (drill through 2 parts) via markPierce in each
  // firearm's apply(). Spray (shotgun/grapeshot) + cannon/rocket/grenade are
  // intentionally NOT routed, so the blurb is explicit about the scope.
  sharedNode({
    id: 'g.ordnance.ap_rounds', parents: ['g.ordnance.gun'], cost: 450,
    family: 'firearms', flag: 'pierce',
    label: 'Armor-piercing rounds',
    blurb: 'Single-shot firearm rounds (pistol through minigun) drill through two parts before they stop. Shotgun and grapeshot pellets, cannonballs, rockets and grenades are unaffected.',
    effect: (fam) => { fam.pierce = true; },
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
  // re-root); frag grenade hangs off it and molotov off frag. Creeping barrage,
  // cluster munition, and breaching charge all fork the root; airstrike is
  // deferred to a later batch.
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
  // Creeping barrage — walks K shells along a line via the S4 scheduler. Mortar fork.
  toolNode({
    id: 'g.ordnance.creeping_barrage', parents: ['g.ordnance.mortar'], cost: 280, toolId: 'creeping_barrage',
    label: 'creeping barrage',
    blurb: 'Mark a line; four shells walk across the buddy on a timed schedule.',
  }),
  statNode({
    id: 'g.ordnance.creeping_barrage.walk', parents: ['g.ordnance.creeping_barrage'], cost: 600, toolId: 'creeping_barrage',
    label: 'Sustained fire',
    blurb: 'Shells 4 → 6, each blast radius 130 → 156.',
    effect: (s) => { s.count = 6; s.radius = Math.round(s.radius * 1.2); },
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

  // Breaching charge (B4) <- root. Stick charges, blow them on command. The
  // two leaves are stat nodes (a toolNode runs no effect, so re-pointing at the
  // already-owned tool would cash nothing): detonation cord reads s.chained for
  // the linking blast; shaped charge bumps the read scalars (mood, baseVel).
  toolNode({
    id: 'g.ordnance.breaching_charge', parents: ['g.ordnance.mortar'], cost: 230, toolId: 'breaching_charge',
    label: 'breaching charge',
    blurb: 'Stick a shaped charge to a limb and blow it on command. Click empty space to detonate every charge at once.',
  }),
  statNode({
    id: 'g.ordnance.breaching_charge.detonation_cord', parents: ['g.ordnance.breaching_charge'], cost: 300, toolId: 'breaching_charge',
    label: 'detonation cord',
    blurb: 'Daisy-chains your charges: blast radius +15%, and with two or more placed, a linking blast rips through the middle of the string.',
    effect: (s) => { s.chained = true; s.radius = Math.round(s.radius * 1.15); },
  }),
  statNode({
    id: 'g.ordnance.breaching_charge.shaped_charge', parents: ['g.ordnance.breaching_charge.detonation_cord'], cost: 380, toolId: 'breaching_charge',
    label: 'shaped charge',
    iconHint: '⚡',
    blurb: 'A focused cone: each charge detonates with a tighter, far harder-hitting blast (mood ×1.5, fling ×1.3).',
    effect: (s) => { s.mood = Math.round(s.mood * 1.5); s.baseVel = Math.round(s.baseVel * 1.3); },
  }),

  // Cluster munition (B4) <- root. Airburst canister → capped bomblet fan. More
  // bomblets is a scalar leaf; Thermite flips the igniteBomblets flag (each
  // bomblet leaves a fire pool) — shipped as a stat flag, not a 4th tool.
  toolNode({
    id: 'g.ordnance.cluster_munition', parents: ['g.ordnance.mortar'], cost: 260, toolId: 'cluster_munition',
    label: 'cluster munition',
    blurb: 'Lob a canister that airbursts at the top of its arc into a fan of raining bomblets.',
  }),
  statNode({
    id: 'g.ordnance.cluster_munition.bomblets', parents: ['g.ordnance.cluster_munition'], cost: 300, toolId: 'cluster_munition',
    label: 'more bomblets',
    blurb: 'Bomblet count 9 → 14 (caps at 12 per burst). A wider, denser footprint of little blasts.',
    effect: (s) => { s.bomblets = 14; },
  }),
  statNode({
    id: 'g.ordnance.cluster_munition.thermite', parents: ['g.ordnance.cluster_munition'], cost: 360, toolId: 'cluster_munition',
    label: 'thermite',
    iconHint: '⚡',
    blurb: 'Incendiary submunitions: each bomblet bursts into a clinging fire pool.',
    effect: (s) => { s.igniteBomblets = true; },
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

  // Railgun, hypervelocity tungsten slug that pierces a whole LINE of parts
  // (pierce_bullet consumer). Independent root (an unlock you take, not a
  // pistol fork); family: firearms so it routes through aimAngle + the
  // firearms reticle and sits beside the other aimed ordnance.
  toolNode({
    id: 'g.ordnance.railgun', parents: [], cost: 520, toolId: 'railgun',
    label: 'railgun',
    blurb: 'Electromagnetic launcher: a hypervelocity tungsten slug pierces a whole line of parts.',
  }),
  statNode({
    id: 'g.ordnance.railgun.tungsten', parents: ['g.ordnance.railgun'], cost: 600, toolId: 'railgun',
    label: 'Tungsten penetrator',
    blurb: 'Damage 40 → 56, pierce 4 → 6 (a full line).',
    effect: (s) => { s.damage = 56; s.pierce = 6; },
  }),
  statNode({
    id: 'g.ordnance.railgun.overcharge', parents: ['g.ordnance.railgun'], cost: 700, toolId: 'railgun',
    label: 'Overcharge',
    blurb: 'Slug speed 48 → 64, heavier screen shake.',
    effect: (s) => { s.speed = 64; s.shake = 20; },
  }),

  // Sabot spread <- railgun. A discarding-sabot load: fires a CONE of K lighter
  // penetrator darts instead of one deep slug, each drilling a couple of parts.
  // The only tool in the SPREAD × PENETRATES cell (grapeshot spreads but stops;
  // railgun/sniper pierce but fire one line). NO synchronous knockback pass — the
  // travelling sabots are the whole damage model, so it's not grapeshot; per-dart
  // pierce/damage stay below the rail's single slug, so it's a sidegrade not an
  // upgrade. Leaves cash distinct axes: Choke removed → coverage (sabots/cone);
  // Tungsten darts → depth (pierce/damage).
  toolNode({
    id: 'g.ordnance.sabot_spread', parents: ['g.ordnance.railgun'], cost: 560, toolId: 'sabot_spread',
    label: 'sabot spread',
    blurb: 'A discarding-sabot load for the rail: one pull fans a cone of lighter penetrator darts that each drill a couple of parts, saturating a cluster instead of one precise line.',
  }),
  statNode({
    id: 'g.ordnance.sabot_spread.wider', parents: ['g.ordnance.sabot_spread'], cost: 320, toolId: 'sabot_spread',
    label: 'Choke removed',
    blurb: 'Sabots 5 → 7, cone 0.42 → 0.58 — a wider, denser fan blankets the whole silhouette.',
    effect: (s) => { s.sabots = 7; s.coneRad = 0.58; },
  }),
  statNode({
    id: 'g.ordnance.sabot_spread.tungsten_darts', parents: ['g.ordnance.sabot_spread'], cost: 420, toolId: 'sabot_spread',
    label: 'Tungsten darts',
    iconHint: '⚡',
    blurb: 'Each dart drills deeper and hits harder: pierce 2 → 3, damage 16 → 24 (still a fan, not the rail\'s single deep slug).',
    effect: (s) => { s.pierce = 3; s.damage = 24; },
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
  toolNode({
    id: 'g.ordnance.subwoofer', parents: ['g.ordnance.flashbang'], cost: 230, toolId: 'subwoofer',
    label: 'subwoofer',
    blurb: 'Drop a speaker stack that thuds out a concussive pulse on a steady beat, dazing everything in range.',
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

  // Lightning storm — a scheduler-walked volley of the lightning strike core.
  // Parents the lightning root (DOCS §3). Each bolt reuses getStats('lightning')
  // for damage/VFX, so the chains/Zeus upgrades above flow into the storm for
  // free; the storm's OWN stats are the volley shape (count/interval).
  toolNode({
    id: 'g.ordnance.lightning_storm', parents: ['g.ordnance.lightning'], cost: 450, toolId: 'lightning_storm',
    label: 'lightning storm',
    blurb: 'A walking barrage of sky bolts on a timed schedule. Each strike is local, so fire and ice set up combos limb by limb across the volley.',
  }),
  statNode({
    id: 'g.ordnance.lightning_storm.supercell', parents: ['g.ordnance.lightning_storm'], cost: 600, toolId: 'lightning_storm',
    label: 'Supercell',
    blurb: 'Bolts 5 → 8 — the storm rolls longer across the body.',
    effect: (s) => { s.count = 8; },
  }),
  statNode({
    id: 'g.ordnance.lightning_storm.rolling_thunder', parents: ['g.ordnance.lightning_storm.supercell'], cost: 900, toolId: 'lightning_storm',
    iconHint: '⚡',
    label: 'Rolling thunder',
    blurb: 'Bolts fall faster (every 0.36s → 0.22s) and the storm opens sooner.',
    effect: (s) => { s.intervalMs = 220; s.startDelayMs = 400; },
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
