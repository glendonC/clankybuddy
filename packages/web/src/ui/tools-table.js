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

  // POSITIVE / provision (folded `gifts` + `blessings` in Phase 1)
  { id: 'feed',        label: 'treat',        key: '2', kind: 'click',     delta: '+4',   spine: 'positive', group: 'provision',
    blurb: 'drops a cookie they bite' },
  { id: 'gift',        label: 'gift',         key: '4', kind: 'click',     delta: '+10',  spine: 'positive', group: 'provision', cost: 80,
    blurb: 'wrapped box, biggest standard boost' },
  { id: 'first_aid',   label: 'first aid',    key: '3', kind: 'click',     delta: '+18',  spine: 'positive', group: 'provision', cost: 90,
    blurb: 'patch them up: mood boost + clears BLEED and ON_FIRE off every part' },
  { id: 'defibrillator',label: 'defibrillator',key: '', kind: 'click',     delta: '+35',  spine: 'positive', group: 'provision', cost: 160, cd: 2,
    blurb: "crash-cart paddles. shock a BROKEN or KO'd buddy back to life — clears the knockout and jolts mood up out of rock-bottom." },
  { id: 'adrenaline',  label: 'adrenaline shot',key: '', kind: 'click',    delta: '+4+tough',spine: 'positive', group: 'provision', cost: 140, cd: 3,
    blurb: 'jab the buddy with adrenaline. a brief amped toughness window halves incoming damage so the beatdown runs longer.' },

  // NEGATIVE / kinetic (renamed from `melee`)
  { id: 'punch',       label: 'punch',        key: 'Q', kind: 'click',     delta: '−8',   spine: 'negative', group: 'kinetic',
    blurb: 'fast point impulse where you click' },
  { id: 'brass_knuckles',label: 'brass knuckles',key: 'A', kind: 'click',  delta: '−9+concuss',spine: 'negative', group: 'kinetic', cost: 90,
    blurb: 'a punch that leaves the part CONCUSSED → the next hit lands ×1.5. self-chains.' },
  { id: 'hammer',      label: 'hammer',       key: 'W', kind: 'click',     delta: '−16',  spine: 'negative', group: 'kinetic', cost: 75,
    blurb: 'heavy single strike, big knockback' },
  { id: 'sword',       label: 'machete',      key: 'E', kind: 'hold+drag', delta: '−2/t', spine: 'negative', group: 'kinetic', cost: 150,
    blurb: 'hold and drag through them, slice continuously' },
  { id: 'whip',        label: 'whip',         key: 'K', kind: 'click',     delta: '−5+chain',spine: 'negative', group: 'kinetic', cost: 110,
    blurb: 'chain-hit. primary part takes a welt + 2 nearest take echoes. all four lashed for 4s.' },
  { id: 'chainsaw',    label: 'chainsaw',     key: 'H', kind: 'hold+drag', delta: '−3/t+bleed', spine: 'negative', group: 'kinetic', cost: 220,
    blurb: 'rev-and-drag, every tick stacks BLEED intensity (caps at 5×). longer drag, deeper wound.' },
  // NEGATIVE / kinetic — Batch 3B grounded melee roster.
  // No bare single keys remain free (1-9,0 + A-Z + Space are all bound), and
  // input is hotbar-slot based anyway: keyboard.js dispatches by physical slot
  // (Digit*), never by `key`, and TOOLS_BY_KEY has no consumers. `key` is only a
  // display chip (slot-picker renders it when truthy), so these melee tools ship
  // with no chip rather than a non-dispatchable one. Equip to a hotbar slot to use.
  { id: 'bat',           label: 'baseball bat', key: '', kind: 'click',     delta: '−12',  spine: 'negative', group: 'kinetic', cost: 130, family: 'melee',
    blurb: 'wide swing. launches every part in the arc sideways, not just the one you aimed at.' },
  { id: 'hunting_knife', label: 'hunting knife',key: '', kind: 'click',     delta: '−7+bleed', spine: 'negative', group: 'kinetic', cost: 130, family: 'melee',
    blurb: 'short, fast stab. small knockback, leaves the part BLEEDing.' },
  { id: 'cattle_prod',   label: 'cattle prod',  key: '', kind: 'click',     delta: '−7+zap', spine: 'negative', group: 'kinetic', cost: 130, family: 'melee',
    blurb: 'short jab that ELECTRIFIES the part (brief convulsions). shatters a frozen limb instead.' },
  { id: 'caltrops',      label: 'caltrops',     key: '', kind: 'drag',      delta: '−3+bleed', spine: 'negative', group: 'kinetic', cost: 180, cd: 4, family: 'melee',
    blurb: 'scatter a spike strip on the floor. anything that lands on or rolls across it BLEEDs (stacks to 5×).' },
  { id: 'blowtorch',     label: 'blowtorch',    key: '', kind: 'hold',      delta: '−1/t', spine: 'negative', group: 'kinetic', cost: 200, family: 'melee',
    blurb: 'hold the cutting torch on one limb, the longer you dwell the hotter it burns (ramps ON_FIRE). shatters frozen parts.' },
  { id: 'nail_gun',      label: 'nail gun',     key: '', kind: 'hold',      delta: '−2/t+bleed', spine: 'negative', group: 'kinetic', cost: 170, family: 'melee',
    blurb: 'rapid-fire hold. each staple stacks BLEED (caps 5×) and pins the limb with a short stun.' },
  { id: 'power_drill',   label: 'power drill',  key: '', kind: 'hold',      delta: '−2/t+bleed', spine: 'negative', group: 'kinetic', cost: 320, family: 'melee',
    blurb: 'hold the bit on one part, the wound deepens. drill the same spot and BLEED ramps to 5×. move off and it resets.' },
  { id: 'battle_axe',    label: 'battle axe',   key: '', kind: 'click',     delta: '−20',  spine: 'negative', group: 'kinetic', cost: 300, cd: 0.7, family: 'melee',
    blurb: 'heavy two-handed cleave. wide radial chop flings the limb cluster; edged, so it bleeds on contact.' },
  { id: 'fire_axe',      label: 'fire axe',     key: '', kind: 'click',     delta: '−12',  spine: 'negative', group: 'kinetic', cost: 380, family: 'melee', edged: true,
    blurb: 'wide cleave that sets struck parts ablaze. edged.' },

  // NEGATIVE / ordnance (renamed from `ranged`; lightning joined this
  // group in Phase 2, it's a ranged-form damage tool, not a status DoT)
  { id: 'gun',         label: 'pistol',       key: 'G', kind: 'click',     delta: '−10',  spine: 'negative', group: 'ordnance', family: 'firearms', cost: 75,
    blurb: 'one-shot pistol, fast aim, light damage' },
  { id: 'revolver',    label: 'revolver',     key: '6', kind: 'click',     delta: '−18',  spine: 'negative', group: 'ordnance', family: 'firearms', cost: 140,
    blurb: 'six heavy magnum shots with big stun, then a forced reload' },
  { id: 'machinegun',  label: 'machine gun',  key: 'R', kind: 'hold',      delta: '−1/r', spine: 'negative', group: 'ordnance', family: 'firearms', cost: 100,
    blurb: 'spray bullets, hold to fire, shells eject' },
  { id: 'smg',         label: 'smg',          key: 'S', kind: 'hold',      delta: '−1/r', spine: 'negative', group: 'ordnance', family: 'firearms', cost: 130,
    blurb: 'mobile bullet-hose, fast fire. accuracy blooms wider the longer you hold.' },
  { id: 'assault_rifle',label: 'assault rifle',key: '7', kind: 'hold',     delta: '−3/r', spine: 'negative', group: 'ordnance', family: 'firearms', cost: 180,
    blurb: 'hold to spray; the cone climbs with recoil. control your bursts.' },
  { id: 'lmg',         label: 'lmg',          key: '8', kind: 'hold',      delta: '−3/r', spine: 'negative', group: 'ordnance', family: 'firearms', cost: 260,
    blurb: 'belt-fed: spins up from weak to a wall of lead, then keeps going' },
  { id: 'minigun',     label: 'minigun',      key: '9', kind: 'hold',      delta: '−2/r', spine: 'negative', group: 'ordnance', family: 'firearms', cost: 400,
    blurb: 'fastest fire rate, but the barrel locks where you opened up' },
  { id: 'shotgun',     label: 'shotgun',      key: 'T', kind: 'click',     delta: '−20',  spine: 'negative', group: 'ordnance', family: 'firearms', cost: 120,
    blurb: 'close-range cone, massive knockback, falls off with distance' },
  { id: 'rocket',      label: 'rocket',       key: 'Y', kind: 'click',     delta: '−35',  spine: 'negative', group: 'ordnance', family: 'firearms', cost: 200,
    blurb: 'straight-line projectile + huge splash' },
  { id: 'grenade',     label: 'molotov',      key: 'I', kind: 'drag',      delta: '−25',  spine: 'negative', group: 'ordnance', cost: 120,
    blurb: 'drag to lob, 2s fuse, area boom + lingering fire pool' },
  { id: 'frag_grenade',label: 'frag grenade', key: 'J', kind: 'drag',      delta: '−22+shrapnel',spine: 'negative', group: 'ordnance', cost: 150,
    blurb: 'drag to lob, 2s fuse, dry blast + a radial spray of shrapnel' },
  { id: 'lightning',   label: 'lightning',    key: 'P', kind: 'click',     delta: '−14',  spine: 'negative', group: 'ordnance', cost: 250,
    blurb: 'sky bolt + branching forks. pairs with ice (CONDUCT) and fire (COMBUST).' },
  { id: 'sawblade',    label: 'saw blade',    key: 'L', kind: 'click',     delta: '−12',  spine: 'negative', group: 'ordnance', cost: 180,
    blurb: 'spinning disc ricochets off walls, pure impact damage, no DoT.' },
  // ordnance — cannon-and-mortar batch. All key:'' (hotbar-slot input; bare keys
  // exhausted). The cannon family + sonic cannon are family:'firearms' so they
  // route through aimAngle/AIMED_FIREARMS (manual aim until Targeting computer).
  { id: 'cannon',      label: 'cannon',       key: '', kind: 'click',     delta: '−40',  spine: 'negative', group: 'ordnance', family: 'firearms', cost: 160,
    blurb: 'emplaced cannon fires a heavy iron ball along your aim line, pure crushing impact' },
  { id: 'grapeshot',   label: 'grapeshot',    key: '', kind: 'click',     delta: '−24',  spine: 'negative', group: 'ordnance', family: 'firearms', cost: 200,
    blurb: 'one trigger pull scatters a tight forward cone of iron shot' },
  { id: 'chain_shot',  label: 'chain shot',   key: '', kind: 'click',     delta: '−16/part',spine: 'negative', group: 'ordnance', family: 'firearms', cost: 230,
    blurb: 'two linked balls fly as a pair and clothesline anything caught between them' },
  { id: 'hot_shot',    label: 'hot shot',     key: '', kind: 'click',     delta: '−38+fire',spine: 'negative', group: 'ordnance', family: 'firearms', cost: 260,
    blurb: 'a furnace-heated cannonball that sets the buddy alight and leaves burning embers where it lands' },
  { id: 'mortar',      label: 'mortar',       key: '', kind: 'click',     delta: '−32',  spine: 'negative', group: 'ordnance', cost: 210, cd: 4,
    blurb: 'mark the ground, a shell whistles in from above and detonates' },
  { id: 'flashbang',   label: 'flashbang',    key: '', kind: 'drag',      delta: '−10+concuss',spine: 'negative', group: 'ordnance', cost: 160,
    blurb: 'drag to lob, 2s fuse, blinding flash that concusses everything nearby' },
  { id: 'sonic_cannon',label: 'sonic cannon', key: '', kind: 'click',     delta: '−14+concuss',spine: 'negative', group: 'ordnance', family: 'firearms', cost: 190,
    blurb: 'instant aimed cone, shoves and concusses every part it sweeps' },

  // NEGATIVE / corruption (renamed from `elemental`).
  { id: 'fireball',    label: 'fireball',     key: 'U', kind: 'click',     delta: '−22',  spine: 'negative', group: 'corruption', cost: 180,
    blurb: 'lobbed magic, splash + fire pool on impact' },
  { id: 'flamethrower',label: 'flamethrower', key: 'O', kind: 'hold',      delta: '−1/t', spine: 'negative', group: 'corruption', cost: 140,
    blurb: 'continuous flame stream' },
  { id: 'acid_flask',  label: 'acid flask',   key: '', kind: 'drag',       delta: '−8+corrode', spine: 'negative', group: 'corruption', cost: 180, cd: 1.5,
    blurb: 'lob a flask of caustic acid; it shatters into a lingering green pool that corrodes (×1.4 damage) whatever wades through it.' },
  { id: 'liquid_nitrogen', label: 'liquid nitrogen', key: '', kind: 'hold', delta: 'freeze/t', spine: 'negative', group: 'corruption', cost: 200,
    blurb: 'continuous cryo cone; paints persistent freeze (brittle) onto whatever the stream touches' },
  { id: 'flash_freeze',label: 'cryo grenade', key: '', kind: 'drag',       delta: '−8+freeze', spine: 'negative', group: 'corruption', cost: 220, cd: 1.2,
    blurb: 'lob a flash-freeze grenade; airbursts into a cryo AOE that freezes every limb in range solid (brittle) and arrests it mid-motion. sets up shatter follow-ups.' },
  { id: 'laser_cutter',label: 'laser cutter', key: '', kind: 'hold',       delta: '−1/t+burn', spine: 'negative', group: 'corruption', cost: 220,
    blurb: 'a continuous industrial cutting beam; sweep it across the buddy to slice, burn, and shatter anything frozen' },
  { id: 'taser',       label: 'taser',        key: '', kind: 'click',      delta: '−4+zap', spine: 'negative', group: 'corruption', cost: 200,
    blurb: 'fire two conductive darts; the wires shock and reel the buddy in' },

  // NEGATIVE / cataclysm (renamed from `god`), gravity & screen-clearing drama buttons
  { id: 'anvil',       label: 'anvil',        key: 'Z', kind: 'click',     delta: '−30',  spine: 'negative', group: 'cataclysm', cd: 6,  cost: 300,
    blurb: 'a 200-pound anvil falls from the sky onto your cursor' },
  { id: 'blackhole',   label: 'black hole',   key: 'X', kind: 'click',     delta: '−40', spine: 'negative', group: 'cataclysm', cd: 15, cost: 500,
    blurb: 'singularity sucks them in 3s, then ejection.' },
  { id: 'nuke',        label: 'nuke',         key: 'C', kind: 'click',     delta: '−100', spine: 'negative', group: 'cataclysm', cd: 60, cost: 1000,
    blurb: 'full-screen white-out · total annihilation.' },
  { id: 'force_quit',  label: 'coup de grâce',key: 'B', kind: 'click',     delta: 'BROKEN',spine: 'negative', group: 'cataclysm', cd: 60, cost: 800,
    blurb: 'finisher, only fires on HURT or BROKEN. 1.5s window, then the mood floor drops out.' },

  // NEGATIVE / siege, heavy objects you drop from above to pancake the buddy
  { id: 'brick',       label: 'brick',        key: 'V', kind: 'click',     delta: '−12',  spine: 'negative', group: 'siege', cost: 60,
    blurb: 'drop a brick on your cursor, pancakes the nearest part' },
  { id: 'bowling_ball',label: 'bowling ball', key: 'D', kind: 'click',     delta: '−16',  spine: 'negative', group: 'siege', cost: 120,
    blurb: 'drops and rolls, scattering parts as it tumbles through' },
  { id: 'piano',       label: 'piano',        key: '5', kind: 'click',     delta: '−26',  spine: 'negative', group: 'siege', cost: 220,
    blurb: 'a wide upright piano lands across multiple parts at once' },
  // Siege/vehicle batch. Input is hotbar-slot based and TOOLS_BY_KEY has no
  // consumers, so these ship with key:'' (no display chip) — every bare key is
  // taken. Equip to a hotbar slot to use.
  { id: 'crt',         label: 'CRT monitor',  key: '', kind: 'click',     delta: '−30',  spine: 'negative', group: 'siege', cost: 260,
    blurb: 'drop a CRT monitor on your cursor; the tube bursts and electrifies the struck part' },
  { id: 'car',         label: 'car',          key: '', kind: 'click',     delta: '−34',  spine: 'negative', group: 'siege', cost: 360,
    blurb: 'drop a sedan on the buddy: the chassis flattens whatever it lands on, then the fuel tank ruptures into a fireball and a lingering burn pool' },
  { id: 'steamroller', label: 'steamroller',  key: '', kind: 'click',     delta: '−24',  spine: 'negative', group: 'siege', cost: 320,
    blurb: 'a heavy drum rolls across the stage, flattening every part it runs over' },
  { id: 'city_bus',    label: 'city bus',     key: '', kind: 'click',     delta: '−20',  spine: 'negative', group: 'siege', cost: 480,
    blurb: 'a bus scoops the buddy and carries them clean off the stage' },
  { id: 'trebuchet',   label: 'trebuchet',    key: '', kind: 'drag',      delta: '−30',  spine: 'negative', group: 'siege', cost: 320,
    blurb: 'drag to aim, release to lob a boulder in a high arc, ground-shaking impact on landing' },
  { id: 'office_chair',label: 'office chair', key: '', kind: 'drag',      delta: '−10',  spine: 'negative', group: 'siege', cost: 180,
    blurb: 'drag to fling a rolling chair, ricochets and clatters into them' },
  { id: 'battering_ram',label: 'battering ram',key: '', kind: 'hold+drag',delta: '−16/swing',spine: 'negative', group: 'siege', cost: 280,
    blurb: 'swing an iron-shod oak log along the drag; one heavy directional shove per part, per swing' },

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

  // UTILITY / manipulation — magnet (tractor beam). MUST carry forceMode so the
  // generic OFF seam (input/mouse.js endPress + ui/hotbar.js setActiveTool reads
  // forceMode and setEnabled(tag,false)) turns the force Mode off on release.
  { id: 'magnet',      label: 'magnet',       key: '', kind: 'hold',       delta: '',     spine: 'utility', group: 'manipulation', cost: 160, forceMode: 'force.magnet',
    blurb: 'Tractor beam — hold to drag the buddy toward the cursor and suspend it in midair.' },

  // NEGATIVE / hazard — placed traps. The buddy triggers them by contact.
  // Claymore / Bounding-mine forks hang under landmine (its tree root). No
  // forceMode (placed traps, not force-loop tools).
  { id: 'landmine',         label: 'landmine',         key: '', kind: 'drag',  delta: '−26',          spine: 'negative', group: 'hazard', cost: 650, cd: 20,
    blurb: 'Bury a pressure-plate charge. First contact launches the buddy skyward.' },
  { id: 'electrified_panel',label: 'electrified panel',key: '', kind: 'drag',  delta: '−6/zap',       spine: 'negative', group: 'hazard', cost: 140, cd: 4,
    blurb: 'Drop a live sensor plate — anything standing on it gets zapped (ELECTRIFIED) every ~0.4s until the plate burns out. Drag to widen.' },
  { id: 'buzzsaw_wall',     label: 'buzzsaw wall',     key: '', kind: 'click', delta: '−9+bleed',     spine: 'negative', group: 'hazard', cost: 180, cd: 1.4,
    blurb: 'Mount a spinning blade. Bites anything driven into it and stacks bleed.' },
  { id: 'cryo_mine',        label: 'cryo mine',        key: '', kind: 'drag',  delta: 'freeze AOE',   spine: 'negative', group: 'hazard', cost: 220, cd: 5,
    blurb: 'Bury a pressure-sensor cryo charge. Step on it and it vents an AOE freeze burst — locks the buddy down, no damage. Sets up the shatter.' },
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
    { id: 'siege',      label: 'siege' },
    { id: 'hazard',     label: 'hazard' },
  ]},
  { spine: 'utility', groups: [
    { id: 'manipulation', label: 'manipulation' },
  ]},
];
