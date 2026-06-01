// Kinetic group tree (renamed from `melee` in Phase 1; punch tree
// rewritten in Phase 5 per docs/abilities.md §4). Three-branch evolution
// layer, Haymaker / Jab / Counter, each a recognizable dev-community
// fight-game camp. The branches converge at one merge node ("Haymaker
// Riposte"), demonstrating the CONVERGENT pattern called for in §4.
//
// Refund: see progression/apply-upgrades.js, the old `thunderfist`
// terminal node was removed; players who bought it get a 1200¢ refund
// on next boot (REMOVED_NODE_COSTS in that file).

import { toolNode, statNode, sharedNode } from './_shared.js';

export default [
  toolNode({
    id: 'g.kinetic.punch', parents: [], cost: 0, toolId: 'punch',
    label: 'punch',
    blurb: 'Fast point impulse. The fundamental.',
  }),

  // Brass knuckles, punch that leaves CONCUSSED so hits self-chain (×1.5).
  toolNode({
    id: 'g.kinetic.brass_knuckles', parents: ['g.kinetic.punch'], cost: 90, toolId: 'brass_knuckles',
    label: 'brass knuckles',
    blurb: 'Punch that leaves the part CONCUSSED, the next hit lands ×1.5.',
  }),

  // ── A: Haymaker (slow, heavy single, knockback) ─────────────────
  statNode({
    id: 'g.kinetic.punch.haymaker', parents: ['g.kinetic.punch'], cost: 150, toolId: 'punch',
    label: 'Haymaker',
    blurb: 'Slow heavy single, force +20%, mood damage 8 → 10. Telegraph for the wind-up.',
    effect: (s) => { s.force *= 1.2; s.mood = 10; s.shake = 8; },
  }),
  statNode({
    id: 'g.kinetic.punch.heft', parents: ['g.kinetic.punch.haymaker'], cost: 300, toolId: 'punch',
    label: 'Heft',
    blurb: 'A1, Force +30%. Punches launch limbs across the stage.',
    effect: (s) => { s.force *= 1.3; },
  }),
  statNode({
    id: 'g.kinetic.punch.crushing', parents: ['g.kinetic.punch.heft'], cost: 1200, toolId: 'punch',
    label: 'Crushing',
    iconHint: '⚡',
    blurb: 'A2, Force +60%, mood 10 → 14. Single-strike specialist.',
    effect: (s) => { s.force *= 1.6; s.mood = 14; },
  }),

  // ── B: Jab (fast, low damage, builds combo) ─────────────────────
  statNode({
    id: 'g.kinetic.punch.jab', parents: ['g.kinetic.punch'], cost: 150, toolId: 'punch',
    label: 'Jab',
    blurb: 'Fast, low damage, mood 8 → 6 but force ×0.85; sets up combos.',
    effect: (s) => { s.force *= 0.85; s.mood = 6; },
  }),
  statNode({
    id: 'g.kinetic.punch.quickdraw', parents: ['g.kinetic.punch.jab'], cost: 300, toolId: 'punch',
    label: 'Quickdraw',
    blurb: 'B1, Stun recovery halved (350 → 175ms). Chain into the next hit.',
    effect: (s) => { s.stunMs = 175; },
  }),
  statNode({
    id: 'g.kinetic.punch.flurry', parents: ['g.kinetic.punch.quickdraw'], cost: 1200, toolId: 'punch',
    label: 'Flurry',
    iconHint: '⚡',
    blurb: 'B2, Each hit within 0.5s of the last adds +1 mood damage (cap +8).',
    effect: (s) => { s.flurryWindowMs = 500; s.flurryStep = 1; s.flurryCap = 8; },
  }),

  // ── C: Counter (real conditional now, Phase 7) ─────────────────
  statNode({
    id: 'g.kinetic.punch.counter', parents: ['g.kinetic.punch'], cost: 200, toolId: 'punch',
    label: 'Counter',
    blurb: 'Force ×1.3, shake +30%. Hits during a panic window deal ×2 damage. Trade-on-purpose.',
    effect: (s) => {
      s.force *= 1.3;
      s.shake = Math.round((s.shake || 6) * 1.3);
      s.counterBonusInPanic = true;       // punch.js gates the ×2 damage on this
    },
  }),
  statNode({
    id: 'g.kinetic.punch.riposte', parents: ['g.kinetic.punch.counter'], cost: 600, toolId: 'punch',
    label: 'Riposte',
    blurb: 'C1, knockback range 70 → 95, strips one POWERED buff from the buddy on connect.',
    effect: (s) => { s.range = 95; s.stripBuffOnHit = true; },
  }),

  // ★ CONVERGENT MERGE, requires both A2 (crushing) and C1 (riposte).
  statNode({
    id: 'g.kinetic.punch.haymaker_riposte',
    parents: ['g.kinetic.punch.crushing', 'g.kinetic.punch.riposte'],
    cost: 1500, toolId: 'punch',
    label: 'Haymaker Riposte',
    iconHint: '★',
    blurb: '★ Crushing + Riposte, force ×1.25, mood +6, the merge build.',
    effect: (s) => { s.force *= 1.25; s.mood = (s.mood || 8) + 6; },
  }),

  // ── Hammer branch (existing Phase 1 nodes, untouched) ───────────
  toolNode({
    id: 'g.kinetic.hammer', parents: ['g.kinetic.punch'], cost: 75, toolId: 'hammer',
    label: 'hammer',
    blurb: 'Heavy single strike, big knockback, concussed status.',
  }),
  statNode({
    id: 'g.kinetic.hammer.swing', parents: ['g.kinetic.hammer'], cost: 300, toolId: 'hammer',
    label: 'Wide Swing',
    blurb: 'Range 80 → 120. Catches limbs you barely brushed.',
    effect: (s) => { s.range = 120; },
  }),
  statNode({
    id: 'g.kinetic.hammer.heft', parents: ['g.kinetic.hammer'], cost: 300, toolId: 'hammer',
    label: 'Heft',
    blurb: 'Force +25%, mood damage 16 → 22.',
    effect: (s) => { s.force *= 1.25; s.mood = 22; },
  }),
  statNode({
    id: 'g.kinetic.hammer.thunder', parents: ['g.kinetic.hammer.swing', 'g.kinetic.hammer.heft'], cost: 1200, toolId: 'hammer',
    label: 'Sledgehammer',
    iconHint: '⚡',
    blurb: 'Each hit lands with mega-tier shake + concussed AOE.',
    effect: (s) => { s.shake = 22; s.concussedMs = 2400; s.brittleBonus = 1.8; },
  }),

  // ── Machete branch (tool id 'sword', legacy internal id) ───────
  toolNode({
    id: 'g.kinetic.sword', parents: ['g.kinetic.punch'], cost: 150, toolId: 'sword',
    label: 'machete',
    blurb: 'Hold and drag through them, slice continuously.',
  }),
  statNode({
    id: 'g.kinetic.sword.range', parents: ['g.kinetic.sword'], cost: 250, toolId: 'sword',
    label: 'Long blade',
    blurb: 'Slice range +50%. Reach across two parts in one drag.',
    effect: (s) => { s.range = (s.range || 60) * 1.5; },
  }),
  statNode({
    id: 'g.kinetic.sword.brittle', parents: ['g.kinetic.sword'], cost: 400, toolId: 'sword',
    label: 'Cryo edge',
    blurb: 'Damage on frozen parts +50%. Pairs with rate-limit.',
    effect: (s) => { s.brittleBonus = (s.brittleBonus || 1.4) * 1.5; },
  }),

  // ── Whip branch (Phase 7 visceral kit, extended 2026-05-24) ─────
  // Two-branch evolution: Spread (breadth) vs Barbed (depth).
  toolNode({
    id: 'g.kinetic.whip', parents: ['g.kinetic.punch'], cost: 110, toolId: 'whip',
    label: 'whip',
    blurb: 'Chain-hit. Primary part welts + 2 nearest take echoes. All four LASHED for 4s.',
  }),
  statNode({
    id: 'g.kinetic.whip.spread', parents: ['g.kinetic.whip'], cost: 250, toolId: 'whip',
    label: 'Spread',
    blurb: 'Chain count 2 → 4. The crack reaches.',
    effect: (s) => { s.chains = 4; s.chainRadius = 130; },
  }),
  statNode({
    id: 'g.kinetic.whip.indiana', parents: ['g.kinetic.whip.spread'], cost: 1000, toolId: 'whip',
    label: 'Indiana',
    iconHint: '⚡',
    blurb: 'A2, Chain count 4 → 6, chain radius +30%. The crack-line afterimage lingers (visual flag, PR5 consumer).',
    effect: (s) => { s.chains = 6; s.chainRadius = 170; s.crackAfterimage = true; },
  }),
  statNode({
    id: 'g.kinetic.whip.barbed', parents: ['g.kinetic.whip'], cost: 350, toolId: 'whip',
    label: 'Barbed',
    blurb: 'LASHED rate ×1.5; primary mood damage 5 → 7.',
    effect: (s) => { s.lashedRate = 2.25; s.mood = 7; },
  }),
  statNode({
    id: 'g.kinetic.whip.welt_marker', parents: ['g.kinetic.whip.barbed'], cost: 1000, toolId: 'whip',
    label: 'Welt-Marker',
    iconHint: '⚡',
    blurb: 'B2, LASHED at cap intensity renders persistent welts on the chibi (sprite flag, PR5 consumer). Primary mood 7 → 9.',
    effect: (s) => { s.mood = 9; s.persistentWelts = true; },
  }),

  // ── Chainsaw branch (Phase 7 visceral kit, extended 2026-05-24) ──
  // Long-Bar (reach) vs Carbide-Teeth (depth-per-tick). Both lead to
  // the limp-limb capstone via different routes, A1's twin-detach
  // exploits the long bar's two-part hit, B1's lower cap exploits the
  // faster bleed intensity ramp.
  toolNode({
    id: 'g.kinetic.chainsaw', parents: ['g.kinetic.punch'], cost: 220, toolId: 'chainsaw',
    label: 'chainsaw',
    blurb: 'Rev-and-drag. Each tick stacks BLEED intensity (caps at 5×).',
  }),
  statNode({
    id: 'g.kinetic.chainsaw.bar', parents: ['g.kinetic.chainsaw'], cost: 300, toolId: 'chainsaw',
    label: 'Long bar',
    blurb: 'Bar length 74 → 110. Reach across two parts in one drag.',
    effect: (s) => { s.bladeLen = 110; },
  }),
  statNode({
    id: 'g.kinetic.chainsaw.thirtysix', parents: ['g.kinetic.chainsaw.bar'], cost: 1000, toolId: 'chainsaw',
    label: '36-inch Bar',
    iconHint: '⚡',
    blurb: 'A2, Bar 110 → 150. Two parts at BLEED cap simultaneously → twin limp-limb (PR5 consumer reads limpAtBleedCap).',
    effect: (s) => { s.bladeLen = 150; s.limpAtBleedCap = true; s.twinLimp = true; },
  }),
  statNode({
    id: 'g.kinetic.chainsaw.teeth', parents: ['g.kinetic.chainsaw'], cost: 450, toolId: 'chainsaw',
    label: 'Carbide teeth',
    blurb: 'Per-tick mood 3 → 5; BLEED duration 6s → 10s.',
    effect: (s) => { s.perTickMood = 5; s.bleedMs = 10000; },
  }),
  statNode({
    id: 'g.kinetic.chainsaw.tree_surgeon', parents: ['g.kinetic.chainsaw.teeth'], cost: 1200, toolId: 'chainsaw',
    label: 'Tree-Surgeon',
    iconHint: '⚡',
    blurb: 'B2, BLEED reaches intensity cap in 3 ticks instead of 5. At cap, the limb goes limp (constraint stiffness drops to 0). PR5 consumer.',
    effect: (s) => { s.bleedCapTicks = 3; s.limpAtBleedCap = true; },
  }),

  // ── Bear trap (Phase 7 visceral kit, extended 2026-05-24) ───────
  // Single-branch tree (Sharper-Teeth) with one tier-3 capstone. The
  // "Trapper" branch (multi-trap on stage) needs trap-count-limit
  // mechanics that ship in PR5, deferring.
  toolNode({
    id: 'g.kinetic.bear_trap', parents: ['g.kinetic.punch'], cost: 200, toolId: 'bear_trap',
    label: 'bear trap',
    blurb: 'Drag-place a snap trap. 3s lock + BLEED + CONCUSSED on contact.',
  }),
  statNode({
    id: 'g.kinetic.bear_trap.bite', parents: ['g.kinetic.bear_trap'], cost: 300, toolId: 'bear_trap',
    label: 'Sharper teeth',
    blurb: 'Lock duration 3s → 5s. Bleed duration 8s → 12s.',
    effect: (s) => { s.lockMs = 5000; s.bleedMs = 12000; },
  }),
  statNode({
    id: 'g.kinetic.bear_trap.jaws_of_life', parents: ['g.kinetic.bear_trap.bite'], cost: 1000, toolId: 'bear_trap',
    label: 'Jaws-of-Life',
    iconHint: '⚡',
    blurb: 'A1, Lock 5s → 7s. Trap attaches to the limb and travels with the buddy as they hop (PR5 consumer reads trapAttachesToLimb).',
    effect: (s) => { s.lockMs = 7000; s.trapAttachesToLimb = true; },
  }),

  // ── Meat hook (Phase 7 visceral kit, extended 2026-05-24) ───────
  // Single-branch (Heavy-Chain) with one tier-3 capstone. The "Twin-Hook"
  // branch (two simultaneous hooks) needs a fork in the drag-throw
  // mechanic that ships in PR5.
  toolNode({
    id: 'g.kinetic.meathook', parents: ['g.kinetic.punch'], cost: 240, toolId: 'meathook',
    label: 'meat hook',
    blurb: 'Drag-throw, spears the part then yanks it back to you. Applies BLEED.',
  }),
  statNode({
    id: 'g.kinetic.meathook.yank', parents: ['g.kinetic.meathook'], cost: 350, toolId: 'meathook',
    label: 'Heavy chain',
    blurb: 'Yank velocity +35%, mood damage 8 → 12.',
    effect: (s) => { s.yank = (s.yank || 16) * 1.35; s.mood = 12; },
  }),
  statNode({
    id: 'g.kinetic.meathook.marionette', parents: ['g.kinetic.meathook.yank'], cost: 1000, toolId: 'meathook',
    label: 'Marionette',
    iconHint: '⚡',
    blurb: 'A1, Mood 12 → 16. Post-yank, the cursor stays linked to the part for 1.5s, drag it like a puppet (PR5 consumer reads cursorPuppetMs).',
    effect: (s) => { s.mood = 16; s.cursorPuppetMs = 1500; },
  }),

  // ── Batch 3B grounded melee roster ──────────────────────────────
  // Real-world implements hung off the existing kinetic spine. Tree
  // shape per docs/abilities-v3.md §3:
  //   bat, hunting_knife, cattle_prod, blowtorch, caltrops <- root (punch)
  //   battle_axe <- machete (sword); fire_axe <- battle_axe
  //   power_drill, nail_gun <- hunting_knife

  // Baseball bat <- root. Wide swept arc, launches the limb cluster sideways.
  toolNode({
    id: 'g.kinetic.bat', parents: ['g.kinetic.punch'], cost: 130, toolId: 'bat',
    label: 'baseball bat',
    blurb: 'Wide swept arc. Catches every limb in the swing and launches them sideways.',
  }),

  // Hunting knife <- root. Short fast stab, edged, leaves BLEED.
  toolNode({
    id: 'g.kinetic.hunting_knife', parents: ['g.kinetic.punch'], cost: 130, toolId: 'hunting_knife',
    label: 'hunting knife',
    blurb: 'Short, fast stab. Small knockback, leaves the part BLEEDing. Edged.',
  }),

  // Power drill <- hunting knife. Hold-on-a-part, BLEED ramps to 5×.
  toolNode({
    id: 'g.kinetic.power_drill', parents: ['g.kinetic.hunting_knife'], cost: 320, toolId: 'power_drill',
    label: 'power drill',
    blurb: 'Hold on one part, BLEED ramps toward 5× the longer you dwell; resets on target change.',
  }),

  // Nail gun <- hunting knife. Rapid hold, staples stack BLEED + brief pin.
  toolNode({
    id: 'g.kinetic.nail_gun', parents: ['g.kinetic.hunting_knife'], cost: 170, toolId: 'nail_gun',
    label: 'nail gun',
    blurb: 'Rapid hold. Staples stack BLEED (caps 5×) and briefly pin the part.',
  }),

  // Cattle prod <- root. Short jab, ELECTRIFIES; shatters frozen.
  toolNode({
    id: 'g.kinetic.cattle_prod', parents: ['g.kinetic.punch'], cost: 130, toolId: 'cattle_prod',
    label: 'cattle prod',
    blurb: 'Short jab. ELECTRIFIES the struck part; shatters a frozen one.',
  }),

  // Blowtorch <- root. Hold-on-a-part cutting torch, ramps ON_FIRE.
  toolNode({
    id: 'g.kinetic.blowtorch', parents: ['g.kinetic.punch'], cost: 200, toolId: 'blowtorch',
    label: 'blowtorch',
    blurb: 'Hold-on-a-part cutting torch. Dwell ramps ON_FIRE intensity (caps at 5×); shatters frozen.',
  }),

  // Caltrops <- root. Drag-place a lingering spike strip that BLEEDs.
  toolNode({
    id: 'g.kinetic.caltrops', parents: ['g.kinetic.punch'], cost: 180, toolId: 'caltrops',
    label: 'caltrops',
    blurb: 'Drag-place a spike strip. Lingering floor hazard, BLEEDs any part that lands on or rolls across it, stacking to 5×.',
  }),

  // Battle axe <- machete (tool id 'sword'). Heavy radial cleave + edged bleed.
  toolNode({
    id: 'g.kinetic.battle_axe', parents: ['g.kinetic.sword'], cost: 300, toolId: 'battle_axe',
    label: 'battle axe',
    blurb: 'Heavy cleave. Wide radial chop + edged bleed. Branches off the machete.',
  }),

  // Fire axe <- battle axe. Cleave that sets struck parts ablaze; edged.
  toolNode({
    id: 'g.kinetic.fire_axe', parents: ['g.kinetic.battle_axe'], cost: 380, toolId: 'fire_axe',
    label: 'fire axe',
    blurb: 'Cleave + ignite. Struck parts catch fire (persistent); edged, so they bleed too.',
  }),

  // ── Shepherd's crook (B4) <- root ───────────────────────────────
  // Hook one limb and drag it under gravity via the shared cursor-follow Mode.
  // Cargo hook is a pure scalar leaf (reach + tear-free span), correctly a
  // statNode per the §3 legend.
  toolNode({
    id: 'g.kinetic.shepherds_crook', parents: ['g.kinetic.punch'], cost: 170, toolId: 'shepherds_crook',
    label: "shepherd's crook",
    blurb: 'Hook the nearest limb and drag it around with your cursor; release to drop it.',
  }),
  statNode({
    id: 'g.kinetic.shepherds_crook.cargo_hook', parents: ['g.kinetic.shepherds_crook'], cost: 300, toolId: 'shepherds_crook',
    label: 'Cargo hook',
    blurb: 'A longer pole: latch a limb from farther away (reach 140 → 180) and drag it across a wider span before it slips the hook (360 → 520).',
    effect: (s) => { s.reach = 180; s.maxReach = 520; },
  }),

  // ── Shared melee family behavior flags (S8) ─────────────────────
  // Cross-tool nodes that flip a FLAG every melee tool reads, never a
  // scalar (the sharedNode guard rejects scalar-only effects).
  sharedNode({
    id: 'g.kinetic.melee.flurry', parents: ['g.kinetic.punch'], cost: 400,
    family: 'melee', flag: 'flurry',
    label: "Brawler's tempo",
    iconHint: '⚔',
    blurb: 'Every swing melee tool lands a synchronous second hit the same frame.',
    effect: (fam) => { fam.flurry = true; },
  }),
  sharedNode({
    id: 'g.kinetic.melee.bleed_edge', parents: ['g.kinetic.hunting_knife'], cost: 450,
    family: 'melee', flag: 'bleedOnEdge',
    label: 'Bleed edge',
    iconHint: '⚔',
    blurb: 'Every edged melee tool opens a BLEED wound on contact, even a clean hit.',
    effect: (fam) => { fam.bleedOnEdge = true; },
  }),
];
