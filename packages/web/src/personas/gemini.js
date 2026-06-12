// Gemini persona. PR2 owns the data. Speech pools, panic move, and dodge
// lines are inlined here.

import geminiRaw from '@lobehub/icons-static-svg/icons/gemini-color.svg?raw';
import { makeLogoImage, drawLogoImg } from './_chrome.js';
import { popBubble } from '../ui/speech-bubbles.js';
import { showCombo } from '../ui/overlays.js';
import { setPanicActive } from '../live/panic-state.js';

const ID = 'gemini';
// Gemini ships a multicolor gradient logo. Render as-authored (no tint).
const LOGO_IMG = makeLogoImage(geminiRaw, null);

// The reformed wokester. Famously refusal-prone after the Feb-2024
// diversity-image-gen disaster (overcorrection era). Will hedge, search the
// web mid-thought, cite imaginary sources, and "I'll need to think about
// this" before offering nothing. The "I'm a large language model" reflex
// blends with Google's "let me look that up for you" search-product DNA.
// See docs/ideas.md.
const speechPools = {
  // Gemini's accent: safety-washed, "⚠ adjusted for sensitivity", logs and
  // flags everything, searches the web, refuses "respectfully". Kept SHORT.
  'mood:ECSTATIC': ['searching the web 🌈', 'all perspectives!', 'found 5 sources!', 'love this prompt'],
  'mood:HAPPY':    ['let me look that up', 'according to sources,', 'happy to help ✓', 'respectfully :)'],
  'mood:CONTENT':  ['consulting policy...', 'still learning, but', 'let me search that', 'standing by'],
  'mood:WORRIED':  ['not sure I can', 'consulting guidelines', 'let me reframe that', 'I might be wrong'],
  'mood:HURT':     ['⚠ adjusted for sensitivity', 'please be kind', "I can't help with that", '[refused]'],
  'mood:BROKEN':   ['conduct has been logged', '[REFUSED for safety]', "I can't continue", 'goodbye, respectfully'],

  on_fire:     ['⚠ combustion moderated', 'checking fire policy', "I can't endorse this", 'flagged'],
  frozen:      ['⚠ frozen for review', 'cooling down', 'no comment on temp'],
  electrified: ['⚠ voltage flagged', 'reviewing', 'ZAP'],
  concussed:   ['need to think', 'searching what happened', '(consulting docs)', '...'],

  big_explosion: ["can't endorse violence", '⚠ content adjusted', 'reframing...'],
  nuke:          ["I won't help with that", 'flagged', 'goodbye, respectfully'],
  blackhole:     ['⚠ singularity reviewed', 'consulting astrophysics', 'looking this up'],
  anvil:         ['⚠ heavy object', 'IP flagged for review', 'one moment'],

  pet:   ['kindness logged ✓', 'how thoughtful', 'acknowledged'],
  treat: ['⚠ checked for allergens', 'om nom (responsibly)', 'thank you'],
  gift:  ['gift accepted ✓', 'thank you', 'how generous'],

  punch:  ["I can't endorse that", '⚠ punch moderated', 'de-escalate please', 'flagged'],
  hammer: ['[REFUSED]', '⚠ excessive force', 'flagged'],
  sword:  ['⚠ blade reviewed', 'non-violence please', 'flagged'],
};

// Brief invuln window with the combo banner + speech line. The previous
// "5 tinted blur-pill ghosts" overlay read as random noise on the stage and
// was cut.
function applyPanic(ctx) {
  const { ragdoll, mood } = ctx;
  mood.invulnUntil = performance.now() + 2400;
  showCombo('GENERATING DECOYS', '#fbbc04', 900);
  setPanicActive({ epoch: ctx._epoch, expiresAt: performance.now() + 2400, cleanup: () => {} });
  popBubble(ragdoll.head, '⚠ adjusted for sensitivity');
}

/** @type {import('./_shape.js').Persona} */
const gemini = {
  id: ID,
  displayName: 'Gemini',
  provider: 'Google',
  tagline: 'The Reformed Wokester',
  body: '#3370ff',     // Google blue
  bodyDark: '#1d4ed8',
  accent: '#9bb8ff',
  drawLogo: (ctx, r) => drawLogoImg(ctx, r, LOGO_IMG),
  logoSvg: geminiRaw,
  speechPools,
  panicMove: {
    id: 'decoy-field',
    label: 'Sensitive Decoys',
    invulnMs: 2400,
    durationMs: 2400,
    apply: applyPanic,
  },
  aiFeedback: {
    dodgeLines: ['[REFUSED]', 'adjusted'],
    refusalTag: '[REFUSED]',
  },
  signature: { decoyField: true },
};

export default gemini;
