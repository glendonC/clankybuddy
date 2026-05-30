// Inline SVG icon library for the shop dome.
//
// Each entry is a path drawn around the origin (0,0) inside a conceptual
// 32×32 box (-16..16). Some are stroke-only outlines; some are solid fills.
// Stroke vs fill is encoded per icon so the renderer can switch between
// `<path stroke="..."/>` and `<path fill="..."/>` styling.
//
// Pick icons by tool id (kind:'tool' nodes) or by category (stat nodes fall
// back to a chevron-up "upgrade" glyph keyed by the parent group).

export const ICONS = {
  // ---- praise / affection / gifts / blessings ----
  pet:          { d: 'M 0 9.5 C -10 2.5 -11 -6.5 -5 -8.5 C -1 -9.5 0 -4.5 0 -2.5 C 0 -4.5 1 -9.5 5 -8.5 C 11 -6.5 10 2.5 0 9.5 Z', fill: true },
  // Bone, reads instantly as "treat".
  feed:         { d: 'M -8 0 a 3.5 3.5 0 1 1 4 4 h 8 a 3.5 3.5 0 1 1 4 -4 a 3.5 3.5 0 1 1 -4 -4 h -8 a 3.5 3.5 0 1 1 -4 4 z', fill: false },
  gift:         { d: 'M -10 -5.5 h 20 v 4 h -20 z M -8 -1.5 h 16 v 11 h -16 z M 0 -5.5 v 15 M -8 -5.5 c 0 -7 7 -3 8 0 c 1 -3 8 -7 8 0', fill: false },
  // First aid kit, case with a plus cross.
  first_aid:    { d: 'M -10 -7 h 20 v 14 h -20 z M -2 -4 v 3 h -3 v 2 h 3 v 3 h 2 v -3 h 3 v -2 h -3 v -3 z', fill: false },

  // ---- melee ----
  punch:        { d: 'M -8 -7 h 16 v 14 h -16 z M -4 -7 v 4 M 0 -7 v 4 M 4 -7 v 4', fill: false },
  hammer:       { d: 'M -10 -10 h 20 v 7 h -20 z M -2 -3 h 4 v 14 h -4 z', fill: false },
  sword:        { d: 'M 0 -12 l 3 0 v 18 l 4 0 v 2 l -4 0 v 4 l -6 0 v -4 l -4 0 v -2 l 4 0 v -18 z', fill: false },
  // Brass knuckles, four-hole bar.
  brass_knuckles: { d: 'M -11 -3 h 22 v 6 h -22 z M -8 -2 a 1.4 1.4 0 1 0 0.01 0 z M -3 -2 a 1.4 1.4 0 1 0 0.01 0 z M 2 -2 a 1.4 1.4 0 1 0 0.01 0 z M 7 -2 a 1.4 1.4 0 1 0 0.01 0 z', fill: false },

  // ---- ranged ----
  // Pistol silhouette, slide on top, angled grip below.
  gun:          { d: 'M -11 -4.5 H 11 V -0.5 H -2 l 2 7 H -9 l -2 -7 Z M 4 -4.5 V -6.5 H 8 V -4.5', fill: false },
  // Assault-style rifle, long barrel, magazine well, rear grip.
  machinegun:   { d: 'M -13.5 -4.5 H 10.5 V -0.5 H -1.5 V 4.5 H -3.5 V -0.5 H -9.5 V 2.5 H -11.5 V -0.5 H -13.5 Z M 10.5 -3.5 H 13.5 V -1.5 H 10.5 Z', fill: false },
  // SMG, compact receiver + stubby barrel + vertical mag.
  smg:          { d: 'M -11 -4 H 7 V -1 H -2 V 5 H -4 V -1 H -11 Z M 7 -3 H 11 V -1 H 7 Z', fill: false },
  // Revolver, barrel + round cylinder + grip.
  revolver:     { d: 'M -10 -3 H 6 V 0 H -10 Z M 6 -1.5 H 11 V 0 H 6 Z M -8 0 a 3 3 0 1 0 6 0 a 3 3 0 1 0 -6 0 z M -9 1 L -11 8 H -6 L -5 1 Z', fill: false },
  // Assault rifle, long receiver + barrel + angled mag + stock.
  assault_rifle:{ d: 'M -13 -4 H 11 V -1 H -3 V 5 H -5 V -1 H -10 V 2 H -13 Z M 11 -3 H 14 V -1.5 H 11 Z', fill: false },
  // LMG, heavy receiver + thick barrel + box mag + bipod.
  lmg:          { d: 'M -13 -5 H 9 V -0.5 H -4 V 6 H -6 V -0.5 H -13 Z M 9 -3.5 H 14 V -1.5 H 9 Z M 2 6 V 10 M 6 6 V 10', fill: false },
  // Minigun, barrel cluster + housing.
  minigun:      { d: 'M -12 -5 H -2 V 5 H -12 Z M -2 -3.5 H 13 M -2 -1.2 H 13 M -2 1.2 H 13 M -2 3.5 H 13 M -14 -3 H -12 V 3 H -14 Z', fill: false },
  // Double-barrel shotgun.
  shotgun:      { d: 'M -12 -4 H 8 V -1 H -12 Z M -12 1 H 8 V 4 H -12 Z M 8 -5 H 12 V 5 H 8 Z M -14 -2 H -12 V 2 H -14 Z', fill: false },
  rocket:       { d: 'M 0 -10.5 l 4 6 v 10 l -4 4 -4 -4 v -10 z M -4 5.5 l -4 5 M 4 5.5 l 4 5', fill: false },
  grenade:      { d: 'M -2 -7 h 4 v 2 h 2 v 2 h -8 v -2 h 2 z M -7 0 a 7 8 0 1 0 14 0 a 7 8 0 1 0 -14 0 z M -3 2 h 6 M -3 6 h 6', fill: false },
  // Frag grenade, pineapple body with crosshatch grooves.
  frag_grenade: { d: 'M -2 -9 h 4 v 2 h 2 v 2 h -8 v -2 h 2 z M -7 -1 a 7 7 0 1 0 14 0 a 7 7 0 1 0 -14 0 z M -4 -3 h 8 M -4 1 h 8 M -4 5 h 8 M -2 -5 v 12 M 2 -5 v 12', fill: false },

  // ---- elemental ----
  // Classic teardrop flame with a curl back inside for depth.
  fireball:     { d: 'M 0 -11 C -5 -5 -9 -2 -9 3 A 9 9 0 0 0 9 3 C 9 -2 5 -5 0 -11 Z M 0 -3 C -2 0 -4 2 -3 5 A 4 4 0 0 0 4 4 C 4 1 2 -1 0 -3 Z', fill: false },
  // Torch: tank + nozzle on the left, flame jet on the right.
  flamethrower: { d: 'M -10.5 -6 H -4.5 V 1 H -10.5 Z M -4.5 -4 H 0.5 V -1 H -4.5 Z M 0.5 -6 C 4.5 -5 6.5 -3 8.5 0 C 10.5 5 4.5 6 0.5 4 C -0.5 1 -0.5 -2 0.5 -6 Z', fill: false },
  lightning:    { d: 'M 3 -12 L -6 3 L 0 3 L -3 12 L 8 -3 L 2 -3 Z', fill: true },
  freeze:       { d: 'M 0 -10 v 20 M -9 -5 l 18 10 M -9 5 l 18 -10 M -3 -10 l 3 -3 3 3 M -3 10 l 3 3 3 -3 M -10 -3 l -3 3 3 3 M 10 -3 l 3 3 -3 3', fill: false },

  // ---- cataclysm (was: god) ----
  // Anvil, classic blacksmith silhouette: tapered horn, top face, narrow
  // waist, splayed base. (Reverted from the server-rack reskin in the
  // grounded-roster pass.)
  anvil:        { d: 'M -11 -7 H 6 L 11 -4 L 6 -1 H 2 V 2 H 5 V 4 H -8 V 2 H -2 V -1 H -11 Z M -6 4 H 3 L 6 9 H -9 Z', fill: true },
  blackhole:    { d: 'M -10 0 a 10 10 0 1 0 20 0 a 10 10 0 1 0 -20 0 z M -3 0 a 3 3 0 1 0 6 0 a 3 3 0 1 0 -6 0 z', fill: false },
  nuke:         { d: 'M 0 -3 a 3 3 0 1 0 0.01 0 z M -2 -5 v -8 a 8 8 0 0 0 -8 8 z M 2 -5 v -8 a 8 8 0 0 1 8 8 z M 0 5 v 8 a 8 8 0 0 1 -7 -4 z M 0 5 v 8 a 8 8 0 0 0 7 -4 z', fill: true },

  // ---- utility ----
  grab:         { d: 'M -6.5 -9.5 v 8 M -2.5 -11.5 v 10 M 1.5 -9.5 v 8 M 5.5 -6.5 v 5 M -6.5 -1.5 v 8 q 0 5 6 5 q 7 0 7 -5 v -9', fill: false },

  // ---- kinetic add-ons (post-2026-05 visceral redirect) ----
  // Coiled whip, handle on the right, lashing curl on the left.
  whip:         { d: 'M 8 -8 h 4 v 3 h -3 c -1 3 -4 5 -7 5 c -3 0 -6 2 -8 5 c -2 4 -5 5 -8 4', fill: false },
  // Chainsaw, guide bar with chain teeth on the right, engine box on the left.
  chainsaw:     { d: 'M -11 -4 h 6 v -2 h 4 v 2 h 13 v 5 h -13 v 2 h -4 v -2 h -6 z M -7 -1 h 1 v 1 h -1 z M -3 1 v 1 h 1 v -1 M 1 1 v 1 h 1 v -1 M 5 1 v 1 h 1 v -1 M 9 1 v 1 h 1 v -1', fill: false },
  // Bear trap, two opposing jaws meeting in the middle, chain ring at the bottom.
  bear_trap:    { d: 'M -10 -2 l 3 -3 l 3 3 l 2 -2 l 2 2 l 3 -3 l 3 3 l 2 0 v 4 h -20 z M 0 6 a 3 3 0 1 0 0.01 0 z', fill: false },
  // Meathook, large hook with chain links above.
  meathook:     { d: 'M 0 -12 v 4 M -2 -10 h 4 M 0 -8 v 4 M -2 -6 h 4 M 0 -4 c 0 8 6 8 6 0 M 0 -4 c 0 4 -2 6 -4 4', fill: false },

  // ---- ordnance add-ons ----
  // Sawblade, circle with radial teeth at the rim.
  sawblade:     { d: 'M -8 0 a 8 8 0 1 0 16 0 a 8 8 0 1 0 -16 0 z M 0 -11 v 3 M 0 11 v -3 M -11 0 h 3 M 11 0 h -3 M -8 -8 l 2 2 M 8 8 l -2 -2 M 8 -8 l -2 2 M -8 8 l 2 -2', fill: false },
  // Molotov, bottle with flaming rag on top.
  molotov:      { d: 'M -3 -10 h 6 v 4 l 2 4 v 11 h -10 v -11 l 2 -4 z M 0 -12 c -2 -3 1 -4 0 -6 c 3 2 0 5 0 6 z', fill: false },

  // ---- cataclysm add-ons ----
  // Coup de grâce, downward finisher dagger.
  force_quit:   { d: 'M 0 11 L -3 -5 L -3 -8 H 3 V -5 Z M -6 -5 H 6 V -3 H -6 Z M -1.5 -11 H 1.5 V -8 H -1.5 Z', fill: false },

  // ---- siege (throwables / droppables) ----
  // Brick with mortar grooves.
  brick:        { d: 'M -12 -7 h 24 v 14 h -24 z M -12 0 h 24 M 0 -7 v 7 M -6 0 v 7 M 6 0 v 7', fill: false },
  // Bowling ball, sphere with three finger holes.
  bowling_ball: { d: 'M -10 0 a 10 10 0 1 0 20 0 a 10 10 0 1 0 -20 0 z M -3 -3 a 1.3 1.3 0 1 0 0.01 0 z M 1 -4 a 1.3 1.3 0 1 0 0.01 0 z M -1 1 a 1.3 1.3 0 1 0 0.01 0 z', fill: false },
  // Upright piano, cabinet over a keybed.
  piano:        { d: 'M -12 -9 h 24 v 14 h -24 z M -12 5 h 24 v 4 h -24 z M -9 5 v 4 M -5 5 v 4 M -1 5 v 4 M 3 5 v 4 M 7 5 v 4', fill: false },

  // ---- group fallbacks (used by stat nodes whose toolId icon is missing) ----
  __star:       { d: 'M 0 -10 l 3 6 7 1 -5 5 1 7 -6 -3 -6 3 1 -7 -5 -5 7 -1 z', fill: false },
  __upgrade:    { d: 'M 0 -10 l 8 8 -4 0 0 12 -8 0 0 -12 -4 0 z', fill: true },
  __plus:       { d: 'M -2 -9 h 4 v 7 h 7 v 4 h -7 v 7 h -4 v -7 h -7 v -4 h 7 z', fill: true },
  // Generic placeholder, used when a tool has no entry above. Hex with
  // question-mark hint. Replaces the 2-letter initials fallback that read
  // as "broken settings panel" in the picker.
  __unknown:    { d: 'M 0 -11 l 10 5 v 12 l -10 5 -10 -5 v -12 z M -3 -3 a 3 3 0 1 1 6 0 c 0 2 -3 2 -3 4 M 0 7 a 0.5 0.5 0 1 0 0.01 0 z', fill: false },
};

// Per-group fallback glyph for the pivot half-disk and stat nodes that don't
// match a specific tool. Stat nodes will additionally chain into the parent
// tool's icon when present.
export const GROUP_ICON = {
  master:       '__star',
  affection:    'pet',
  gifts:        'gift',
  blessings:    'gift',
  melee:        'punch',
  ranged:       'gun',
  elemental:    'fireball',
  god:          'nuke',
  siege:        'brick',
  manipulation: 'grab',
};

export function getIcon(name) {
  return ICONS[name] || null;
}
