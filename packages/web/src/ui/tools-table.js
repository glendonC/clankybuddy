// Single source of truth for all actions. Tool ids match abilities/index.js.
// `kind`: click | hold | drag | hold+drag, picks the cursor and hints the
// input loop. `cd` is the cooldown in seconds (god-power items only). `delta`
// is shown in the tooltip, keep in sync with mood values in abilities/.
// `cost` is the unlock price in ¢; tools without a cost are unlocked by
// default (must match progression/state.js DEFAULT_UNLOCKED_TOOLS).
//
// Taxonomy: every tool has a `spine` (mood polarity) and a `group`
// (interaction style). The `TAXONOMY` export below drives toolbar render
// order.
export const TOOLS = [
  // POSITIVE / affection
  { id: 'pet',         label: 'pet',          key: '1', kind: 'hold',      delta: '+1/t', spine: 'positive', group: 'affection',
    blurb: 'gentle continuous stroke, drag along the body' },
  { id: 'compliment',  label: 'glaze',        key: '3', kind: 'click',     delta: '+6→',  spine: 'positive', group: 'affection', cost: 50,
    blurb: 'spam praise, combo bonus. chain ×3 over-flatters them → next attack hits ×1.5.' },

  // POSITIVE / provision (folded `gifts` + `blessings` in Phase 1)
  { id: 'feed',        label: 'treat',        key: '2', kind: 'click',     delta: '+4',   spine: 'positive', group: 'provision',
    blurb: 'drops a cookie they bite' },
  { id: 'gift',        label: 'gift',         key: '4', kind: 'click',     delta: '+10',  spine: 'positive', group: 'provision', cost: 80,
    blurb: 'wrapped box, biggest standard boost' },
  { id: 'gpu',         label: 'gpu',          key: '5', kind: 'click',     delta: '+60',  spine: 'positive', group: 'provision', cost: 200,
    blurb: 'drops a graphics card, buddy glows for ~5s, big sustained boost. cleans bleed.' },

  // NEGATIVE / kinetic (renamed from `melee`)
  { id: 'punch',       label: 'punch',        key: 'Q', kind: 'click',     delta: '−8',   spine: 'negative', group: 'kinetic',
    blurb: 'fast point impulse where you click' },
  { id: 'hammer',      label: 'hammer',       key: 'W', kind: 'click',     delta: '−16',  spine: 'negative', group: 'kinetic', cost: 75,
    blurb: 'heavy single strike, big knockback' },
  { id: 'sword',       label: 'lightsaber',   key: 'E', kind: 'hold+drag', delta: '−2/t', spine: 'negative', group: 'kinetic', cost: 150,
    blurb: 'hold and drag through them, slice continuously' },
  { id: 'whip',        label: 'whip',         key: 'K', kind: 'click',     delta: '−5+chain',spine: 'negative', group: 'kinetic', cost: 110,
    blurb: 'chain-hit. primary part takes a welt + 2 nearest take echoes. all four lashed for 4s.' },
  { id: 'chainsaw',    label: 'chainsaw',     key: 'H', kind: 'hold+drag', delta: '−3/t+bleed', spine: 'negative', group: 'kinetic', cost: 220,
    blurb: 'rev-and-drag, every tick stacks BLEED intensity (caps at 5×). longer drag, deeper wound.' },

  // NEGATIVE / ordnance (renamed from `ranged`; lightning joined this
  // group in Phase 2, it's a ranged-form damage tool, not a status DoT)
  { id: 'gun',         label: 'pistol',       key: 'G', kind: 'click',     delta: '−10',  spine: 'negative', group: 'ordnance', cost: 75,
    blurb: 'one-shot pistol, fast aim, light damage' },
  { id: 'machinegun',  label: 'machine gun',  key: 'R', kind: 'hold',      delta: '−1/r', spine: 'negative', group: 'ordnance', cost: 100,
    blurb: 'spray bullets, hold to fire, shells eject' },
  { id: 'shotgun',     label: 'shotgun',      key: 'T', kind: 'click',     delta: '−20',  spine: 'negative', group: 'ordnance', cost: 120,
    blurb: 'close-range cone, massive knockback, falls off with distance' },
  { id: 'rocket',      label: 'rocket',       key: 'Y', kind: 'click',     delta: '−35',  spine: 'negative', group: 'ordnance', cost: 200,
    blurb: 'straight-line projectile + huge splash' },
  { id: 'grenade',     label: 'molotov',      key: 'I', kind: 'drag',      delta: '−25',  spine: 'negative', group: 'ordnance', cost: 120,
    blurb: 'drag to lob, 2s fuse, area boom + lingering fire pool' },
  { id: 'lightning',   label: 'lightning',    key: 'P', kind: 'click',     delta: '−14',  spine: 'negative', group: 'ordnance', cost: 250,
    blurb: 'sky bolt + branching forks. pairs with ice (CONDUCT) and fire (COMBUST).' },
  { id: 'sawblade',    label: 'saw blade',    key: 'L', kind: 'click',     delta: '−12',  spine: 'negative', group: 'ordnance', cost: 180,
    blurb: 'spinning disc ricochets off walls, pure impact damage, no DoT.' },

  // NEGATIVE / corruption (renamed from `elemental`). Gaslight folded in
  // from the retired `injection` group, same family as poison (head-
  // targeted persistent debuff), one-tool injection group was hollow.
  { id: 'gaslight',    label: 'gaslight',     key: 'J', kind: 'click',     delta: '−3/t', spine: 'negative', group: 'corruption', cd: 8,  cost: 180,
    blurb: 'hijacks the buddy\'s speech for 12s, they trash-talk themselves while you rack up mood damage. cancels glaze.' },
  { id: 'fireball',    label: 'fireball',     key: 'U', kind: 'click',     delta: '−22',  spine: 'negative', group: 'corruption', cost: 180,
    blurb: 'lobbed magic, splash + fire pool on impact' },
  { id: 'flamethrower',label: 'flamethrower', key: 'O', kind: 'hold',      delta: '−1/t', spine: 'negative', group: 'corruption', cost: 140,
    blurb: 'continuous flame stream' },
  { id: 'mode_collapse',label: 'poison',      key: 'V', kind: 'drag',      delta: '−1.5×',spine: 'negative', group: 'corruption', cost: 260,
    blurb: 'drag to drop a zone. 3 buddy passes through it → 12s POISONED (×1.5 damage taken).' },

  // NEGATIVE / cataclysm (renamed from `god`), gravity & screen-clearing drama buttons
  { id: 'anvil',       label: 'anvil',        key: 'Z', kind: 'click',     delta: '−30',  spine: 'negative', group: 'cataclysm', cd: 6,  cost: 300,
    blurb: 'a 200-pound anvil falls from the sky onto your cursor' },
  { id: 'blackhole',   label: 'black hole',   key: 'X', kind: 'click',     delta: '−40', spine: 'negative', group: 'cataclysm', cd: 15, cost: 500,
    blurb: 'singularity sucks them in 3s, then ejection.' },
  { id: 'nuke',        label: 'nuke',         key: 'C', kind: 'click',     delta: '−100', spine: 'negative', group: 'cataclysm', cd: 60, cost: 1000,
    blurb: 'full-screen white-out · total annihilation.' },
  { id: 'force_quit',  label: 'execute',      key: 'B', kind: 'click',     delta: 'BROKEN',spine: 'negative', group: 'cataclysm', cd: 60, cost: 800,
    blurb: 'finisher, only fires on HURT or BROKEN. 1.5s intangible window, then mood wipe.' },

  // UTILITY / manipulation
  // `system: true`, grab is a permanent cursor verb, not a hotbar choice. It
  // lives in a fixed slot left of the hotbar (mirroring the shop on the right)
  // and is filtered out of the slot-picker grid and the starter auto-equip.
  // Space remains the keyboard shortcut; the system-slot button is the
  // mouse-driven equivalent.
  { id: 'grab',        label: 'grab',         key: 'Space', kind: 'drag',  delta: '',     spine: 'utility', group: 'manipulation',
    system: true,
    blurb: 'grab the buddy, drag to throw' },
  { id: 'freeze',      label: 'ice',          key: 'F', kind: 'click',     delta: 'lock',  spine: 'utility', group: 'manipulation', cost: 100,
    blurb: 'freezes them ~2s, pure control. sets up shatter (hammer/lightning) + cauterizes bleed.' },
  { id: 'bear_trap',   label: 'bear trap',    key: 'M', kind: 'drag',      delta: '−10+bleed', spine: 'negative', group: 'kinetic', cost: 200,
    blurb: 'drag-place a trap. snaps shut → 3s lock + BLEED + CONCUSSED (next hit ×1.5).' },
  { id: 'meathook',    label: 'meat hook',    key: 'N', kind: 'drag',      delta: '−8+yank',spine: 'negative', group: 'kinetic', cd: 6, cost: 240,
    blurb: 'drag to throw a hook, spears the part then yanks it back at speed.' },
];

export const TOOLS_BY_ID  = Object.fromEntries(TOOLS.map(t => [t.id, t]));
export const TOOLS_BY_KEY = Object.fromEntries(TOOLS.map(t => [t.key.toUpperCase(), t]));

// Render-order spec: spines top-to-bottom, groups within in this order.
// Toolbar reads this; CSS keys off `data-spine` and `data-group`.
// `recognition` and `injection` retired in Phase 7 (kit redirect,
// citation folded out; gaslight folded into corruption).
export const TAXONOMY = [
  { spine: 'positive', groups: [
    { id: 'affection', label: 'affection' },
    { id: 'provision', label: 'provision' },
  ]},
  { spine: 'negative', groups: [
    { id: 'kinetic',    label: 'kinetic' },
    { id: 'ordnance',   label: 'ordnance' },
    { id: 'corruption', label: 'corruption' },
    { id: 'cataclysm',  label: 'cataclysm' },
  ]},
  { spine: 'utility', groups: [
    { id: 'manipulation', label: 'manipulation' },
  ]},
];
