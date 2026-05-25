// Handle-color palette. Server picks one of VALID_COLORS for each new user
// and stores it on their record; clients render the handle in that color
// using the per-target hex/Ink mapping defined here.
//
// VALID_COLORS is the wire-format vocabulary, adding a name here adds a
// new server-issuable color; removing requires a migration on existing user
// records. Don't shuffle the array; the order doesn't matter functionally
// but it's easier to scan when stable.

export const VALID_COLORS = [
  'red', 'cyan', 'yellow', 'green', 'magenta', 'blue',
  'orange', 'lime', 'pink', 'sky', 'lavender', 'white',
] as const;

export type PaletteColor = (typeof VALID_COLORS)[number];

// Hex map for canvas/CSS rendering on a dark background. Tuned for legibility
// on `--surface-translucent` (≈ rgba(20,22,28,0.7)). Adjust here if a color
// reads as too dim against the chat panel; do NOT add a new entry without
// also adding the name to VALID_COLORS above.
export const COLOR_HEX: Record<PaletteColor, string> = {
  red:      '#ff5c5c',
  cyan:     '#22d3ee',
  yellow:   '#facc15',
  green:    '#4ade80',
  magenta:  '#e879f9',
  blue:     '#60a5fa',
  orange:   '#fb923c',
  lime:     '#a3e635',
  pink:     '#f472b6',
  sky:      '#7dd3fc',
  lavender: '#c8a2f9',
  white:    '#f5f5f5',
};

// Ink-named colors for terminal rendering. Values are either Ink's named
// colors (which terminals tint via the user's theme) or ANSI 256 hexes for
// shades Ink doesn't name. Mirrors COLOR_HEX semantically, same vibe in two
// rendering targets.
export const COLOR_INK: Record<PaletteColor, string> = {
  red:      'red',
  cyan:     'cyan',
  yellow:   'yellow',
  green:    'green',
  magenta:  'magenta',
  blue:     'blue',
  orange:   '#ff8c00',
  lime:     '#a3e635',
  pink:     '#ff79c6',
  sky:      '#87ceeb',
  lavender: '#c8a2f9',
  white:    'white',
};

export function isValidColor(name: string): name is PaletteColor {
  return (VALID_COLORS as readonly string[]).includes(name);
}
