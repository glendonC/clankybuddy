// Compat re-export, chrome data (body color, accent, drawLogo, logoSvg)
// moved into src/personas/<id>.js in PR2. This shim preserves the legacy
// CHARACTERS array shape and LOGO_SVG dict for code paths that haven't
// migrated to listPersonas() / getPersona() yet (stats-popover.js,
// target-picker.js, character-picker.js, ragdoll-lifecycle.js, etc.).
//
// New code should prefer the persona registry directly. This file's
// exports will eventually be retired once every consumer is migrated; for
// now it stays as the bridge so the diff stays small.

import { listPersonas } from '../personas/index.js';

// Roster array, preserves the legacy shape: { id, name, provider, body,
// bodyDark, accent, drawLogo }. Order matches PERSONA_IDS.
export const CHARACTERS = listPersonas().map((p) => ({
  id: p.id,
  name: p.displayName,
  provider: p.provider,
  body: p.body,
  bodyDark: p.bodyDark,
  accent: p.accent,
  drawLogo: p.drawLogo,
}));

// Raw SVG markup keyed by character id, with currentColor preserved on the
// monochrome marks. Boss nameplate injects this as innerHTML to recolor
// via CSS `color`.
export const LOGO_SVG = Object.fromEntries(
  listPersonas().map((p) => [p.id, p.logoSvg]),
);
