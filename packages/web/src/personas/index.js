// Persona registry. Single import surface for code that wants the full
// persona record (chrome, speech pools, panic move, AI-feedback pools).
// As of PR2 each src/personas/<id>.js OWNS its data, speech pools, panic
// move body, dodge lines all live in the persona file directly. The old
// scattered modules (src/reactions/characters/, the HANDLERS table in
// src/live/panic-moves.js, the DODGE_LINES dict in src/live/index.js)
// were retired. src/physics/characters.js stays as a thin compat shim
// re-exporting CHARACTERS from listPersonas().
//
// Module-load invariant: PERSONAS_BY_ID must contain an entry for every
// id in PERSONA_IDS. The check below throws on import if a persona file
// is missing, far better than a silent undefined later in render.

import { PERSONA_IDS } from '@clankybuddy/shared/personas';
import { getActiveChar } from '../state/active-character.js';

import claude   from './claude.js';
import gpt      from './gpt.js';
import gemini   from './gemini.js';
import grok     from './grok.js';
import llama    from './llama.js';
import deepseek from './deepseek.js';

/** @type {Record<string, import('./_shape.js').Persona>} */
export const PERSONAS_BY_ID = {
  claude,
  gpt,
  gemini,
  grok,
  llama,
  deepseek,
};

// Freeze contract, PERSONA_IDS in shared is the wire-format roster; this
// runtime check guarantees the web client can't ship without a matching
// persona file. Any addition to PERSONA_IDS will throw here until the
// new src/personas/<id>.js is wired in above.
for (const id of PERSONA_IDS) {
  if (!PERSONAS_BY_ID[id]) {
    throw new Error(
      `personas/index.js: missing persona file for id '${id}'. ` +
      `PERSONA_IDS in @clankybuddy/shared/personas declares it but no entry was registered.`,
    );
  }
}

/** @returns {import('./_shape.js').Persona[]} */
export function listPersonas() {
  return PERSONA_IDS.map((id) => PERSONAS_BY_ID[id]);
}

/**
 * @param {string} id
 * @returns {import('./_shape.js').Persona}
 */
export function getPersona(id) {
  const p = PERSONAS_BY_ID[id];
  if (!p) {
    throw new Error(`getPersona: unknown persona id '${id}'.`);
  }
  return p;
}

/** @returns {import('./_shape.js').Persona} */
export function getActivePersona() {
  return getPersona(getActiveChar());
}

export { PERSONA_IDS };
