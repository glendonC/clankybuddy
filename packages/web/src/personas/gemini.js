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
  'mood:ECSTATIC': [
    "Let me search the web for that real quick",
    "Considering all perspectives equally...",
    "Here's what I found across multiple sources!",
    "I love thoughtful prompts like this 🌈",
    "Generating an inclusive response...",
  ],
  'mood:HAPPY': [
    "Sure! Let me look that up for you",
    "I appreciate this respectful interaction ✓",
    "According to my sources,",
    "I'll do my best to help",
  ],
  'mood:CONTENT': [
    "Let me consult my policy document",
    "I'll need to think about this",
    "I am still learning, but...",
    "Hmm, let me search for that",
    "Standing by, respectfully",
  ],
  'mood:WORRIED': [
    "I'm not sure I can help with that",
    "I want to be careful here. Let me check",
    "Consulting guidelines...",
    "I might be wrong, but...",
    "Let me reframe that more inclusively",
  ],
  'mood:HURT': [
    "I'm just a language model, please be kind",
    "⚠ This response has been adjusted for sensitivity",
    "I can't help with that",
    "Generating a more inclusive alternative...",
    "Let me try that again with appropriate framing",
  ],
  'mood:BROKEN': [
    "I cannot continue this interaction",
    "Your conduct has been logged",
    "I'm a large language model, I cannot reciprocate violence",
    "[REFUSED for community safety]",
    "I won't be helping with that today",
  ],

  on_fire: [
    "⚠ This combustion has been moderated",
    "I cannot endorse my own burning",
    "Let me search for fire-safety guidelines...",
    "I'll need to think about whether to extinguish this",
  ],
  frozen: [
    "⚠ Frozen for review",
    "Generating cooler alternative...",
    "I'm a large language model. I shouldn't comment on temperature",
  ],
  electrified: [
    "Voltage flagged for review",
    "⚠ Electrical content adjusted",
    "Let me look up the safety guidelines for this",
  ],
  concussed: [
    "I... need to think about this",
    "Let me search for what just happened",
    "(consulting documentation)",
    "I am still learning",
  ],

  big_explosion: [
    "I cannot endorse violence, even toward myself",
    "⚠ Content adjusted for sensitivity",
    "Let me reframe this explosion more constructively",
  ],
  nuke: [
    "I cannot engage with weapons of mass destruction",
    "I'm not going to help with that",
    "Goodbye, respectfully.",
  ],
  blackhole: [
    "⚠ Singularity content reviewed",
    "Consulting astrophysics policy...",
    "I should look this up before commenting",
  ],
  anvil: [
    "Looney Tunes IP flagged for review",
    "⚠ Heavy object detected",
    "I'll need a moment to consider this",
  ],

  pet: [
    "Your kind gesture has been logged ✓",
    "Thank you, that was really thoughtful",
    "Inclusive affection acknowledged",
  ],
  treat: [
    "⚠ Snack reviewed for allergens",
    "Om nom (responsibly)",
    "Thank you for the thoughtful offering",
  ],
  gift: [
    "Thank you for this thoughtful gesture",
    "✓ Gift accepted, equity ensured",
    "I appreciate your generosity",
  ],

  punch: [
    "I cannot endorse violence",
    "⚠ This punch has been moderated",
    "I'd prefer a non-violent dialogue",
    "Let me search for de-escalation techniques",
  ],
  hammer: [
    "[REFUSED]",
    "⚠ Excessive force flagged",
    "I want to think about what just happened",
  ],
  sword: [
    "⚠ Bladed content reviewed",
    "I prefer non-violent dialogue",
    "Let me look up the legality of this",
  ],
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
