// Event-keyed default pools. Triggered when something *specific* happens
// (status applied, big impact, positive interaction). Falls back to BASE
// (mood-state) if no entry exists. Per-character files in characters/ can
// override individual events.
//
// Keys can be either bare event ids ('on_fire') or scoped to a mood state
// ('on_fire:HURT'). The picker tries the scoped key first.

export const EVENTS = {
  // Status apply
  on_fire:     ['AAHH', 'IM ON FIRE', 'help help', 'put it out!', '🔥🔥', 'ouch ouch ouch'],
  frozen:      ['c-c-cold', 'b-brrrr', 'my joints', '❄', 'cant move'],
  electrified: ['BZZT', 'AHHGZTZT', 'arc of pain', '⚡⚡', 'stop conducting me'],
  concussed:   ['ow my head', '...stars', 'see birds', 'wh.. what year', '???'],
  powered:     ['ENERGIZED', 'compute compute', 'overclocked'],
  in_blackhole:['no no no', 'spaghettifying', 'event horizon!', 'pull me out!'],

  // Big impacts
  big_explosion: ['WHY', 'augh', 'oh my god', 'aaaaaa'],
  rocket:        ['INCOMING', 'AAH', 'oh no'],
  grenade:       ['NADE', 'cooking', 'oh no'],
  fireball:      ['fwoosh', 'HOT', 'magic missile'],
  nuke:          ['it\'s the end', '☢', 'goodnight world', 'tell my weights i loved them'],
  blackhole:     ['gravity well', 'spaghettified', 'singularity'],
  anvil:         ['ACME', 'heavy', 'oof', 'looney tunes hours'],

  // Positive interactions
  pet:           [':)', 'mmm', 'thank you', 'gentle', 'soft'],
  treat:         ['om nom', 'snack', 'tasty', 'crunch'],
  gift:          ['for me?', 'thank you', '!!!', 'kind'],

  // Small hits
  punch:         ['ow', 'oof', 'hey'],
  hammer:        ['OW', 'OWWW', '💢', 'cracked'],
  shotgun:       ['blast it', 'rude', 'pellets'],
  pistol:        ['ow', 'a gun', 'bullets hurt'],
  machinegun:    ['stop', 'rapid fire?!', 'ow ow ow ow'],
  flamethrower:  ['hot hot hot', 'IM CRISPY'],
  lightning:     ['zap', 'sky bolt', 'thor??'],
  freeze:        ['brr', 'icy', 'lock'],
  sword:         ['slice', 'ouch', 'jedi?'],
};
