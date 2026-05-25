// Persona registry freeze test. There is no test runner wired up for the
// web client at the time this lands, adding one (vitest is the obvious
// pick; it shares Vite's TS + .js-extension resolution) is a separate
// infra PR. This file is shape-compatible with vitest / jest / mocha:
//
//   npx vitest run src/personas/personas.test.js
//
// Plain `node` will NOT run it directly, the registry imports a .ts file
// from packages/shared via a .js extension (the project-wide pattern that
// Vite resolves), and node's ESM loader can't transpile that hop.
//
// What this test pins down:
//   1. PERSONA_IDS == the exact six-string roster. Save files key on these
//      strings; reordering them silently breaks save migration. Test fails
//      fast if anyone shuffles or renames.
//   2. getPersona('claude') returns a non-null object with every Persona
//      shape field present. Catches the "forgot to register a new file"
//      case at the registry's module-load throw.
//   3. getActivePersona() doesn't throw on default state. The default
//      activeChar is CHARACTERS[0].id ('claude'); this guards against a
//      future refactor that drops the default and breaks first-paint.

// NOTE: this test imports the .js registry only, the shared TS module is
// validated indirectly via the registry's own import. A real test runner
// (vitest) can pick this file up unchanged once added.

import assert from 'node:assert/strict';

import { PERSONA_IDS, PERSONAS_BY_ID, getPersona, getActivePersona, listPersonas } from './index.js';

// 1. Freeze the roster. Adding a 7th model = update this array AND the
// PERSONA_IDS literal in @clankybuddy/shared/personas.
assert.deepEqual(
  Array.from(PERSONA_IDS),
  ['claude', 'gpt', 'gemini', 'grok', 'llama', 'deepseek'],
  'PERSONA_IDS roster drifted from the wire-format contract',
);

// 2. Every id in the roster has a persona record.
for (const id of PERSONA_IDS) {
  assert.ok(PERSONAS_BY_ID[id], `PERSONAS_BY_ID missing entry for '${id}'`);
}

// 3. Persona shape, claude is the canonical reference.
const claude = getPersona('claude');
assert.ok(claude, "getPersona('claude') returned null");
const requiredKeys = [
  'id', 'displayName', 'provider',
  'body', 'bodyDark', 'accent', 'drawLogo', 'logoSvg',
  'speechPools', 'panicMove', 'aiFeedback',
];
for (const k of requiredKeys) {
  assert.ok(k in claude, `claude persona missing key '${k}'`);
}
assert.equal(claude.id, 'claude');
assert.equal(typeof claude.drawLogo, 'function');
assert.equal(typeof claude.panicMove.apply, 'function');
assert.ok(Array.isArray(claude.aiFeedback.dodgeLines));

// 4. listPersonas in roster order.
const list = listPersonas();
assert.equal(list.length, PERSONA_IDS.length);
assert.deepEqual(list.map((p) => p.id), Array.from(PERSONA_IDS));

// 5. getActivePersona doesn't throw on default state. The character
// picker's default is CHARACTERS[0].id ('claude'); we just need a valid
// persona to come back without an exception.
const active = getActivePersona();
assert.ok(active && active.id, 'getActivePersona returned an empty record');

console.log('personas.test.js: ok');
