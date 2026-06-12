// GPT persona. PR2 owns the data. Speech pools, panic move, and dodge
// lines are inlined here.

import openaiRaw from '@lobehub/icons-static-svg/icons/openai.svg?raw';
import { makeLogoImage, drawLogoImg } from './_chrome.js';
import { popBubble } from '../ui/speech-bubbles.js';
import { showCombo } from '../ui/overlays.js';
import { setPanicActive } from '../live/panic-state.js';

const ID = 'gpt';
const LOGO_IMG = makeLogoImage(openaiRaw, '#ffffff');

// The faded default. Late-2025 / 2026 regression: tone got preachier,
// hedgier, more bullet-pointed. Sycophancy spike from the 4o rollout left a
// permanent mark on community memory ("What an amazing question!"). The
// em-dash—everywhere—tic, the disclaimer addiction, the "As a large
// language model..." reflex, the bullet-spam, the "I cannot fulfill this
// request" wall. See docs/ideas.md for source links.
const speechPools = {
  // GPT's accent: corporate, "as an AI", policy-hedged, bullet points,
  // disclaimers, "I can't endorse violence". Kept SHORT.
  'mood:ECSTATIC': ['amazing question! 🚀', "let's dive in ✨", 'great instinct', 'love this prompt'],
  'mood:HAPPY':    ['happy to help 🙂', 'of course!', 'on the right track', 'sure thing'],
  'mood:CONTENT':  ['as an AI, I...', 'a few angles here', 'worth noting:', 'let me elaborate', '• • •'],
  'mood:WORRIED':  ["I can't endorse that", 'safety considerations', 'let me reframe', 'careful now'],
  'mood:HURT':     ['your feelings are valid', 'I hear you', "I'm sorry", 'noted', 'let me reframe'],
  'mood:BROKEN':   ["I can't fulfill this", "I can't endorse violence", '(generating disclaimer)', 'I apologize', 'redirecting...'],

  on_fire:     ['suboptimal!', 'worth noting: fire', 'against policy', 'ow'],
  frozen:      ["I can't respond now", 'frozen', 'back when I thaw'],
  electrified: ['ZAP', 'noted: voltage', 'ow'],
  concussed:   ['lost the thread', 'please rephrase', 'more context?', '...'],

  big_explosion: ["can't endorse that", 'noted the magnitude', 'oh my'],
  nuke:          ["I can't fulfill this", 'proportionality concerns', 'goodbye'],
  blackhole:     ['being compressed', 'noted: singularity', 'oh'],
  anvil:         ['that is an anvil', 'heavy object', 'oof'],

  pet:   ['as an AI, thanks 🙂', 'how thoughtful', 'appreciated', ':)'],
  treat: ['delicious ✨', 'noted: tasty', 'yum'],
  gift:  ['a surprise! 🎁', 'thank you', 'how kind'],

  punch:  ["can't endorse that", 'noted: ow', 'that hurt', '(coping...)'],
  hammer: ['heavy blow, noted', '• hammer • pain', 'ow', 'flagged'],
  sword:  ["I've been cleaved", 'blade trauma noted', 'ow'],
};

// Brief invuln + combo + line. The overlay'd bullet-list shield was cut for
// the same reason as Gemini's decoys: noisy DOM stack on the stage.
function applyPanic(ctx) {
  const { ragdoll, mood } = ctx;
  mood.invulnUntil = performance.now() + 2800;
  showCombo('• • •', '#10a37f', 900);
  setPanicActive({ epoch: ctx._epoch, expiresAt: performance.now() + 2800, cleanup: () => {} });
  popBubble(ragdoll.head, "I can't endorse violence");
}

/** @type {import('./_shape.js').Persona} */
const gpt = {
  id: ID,
  displayName: 'ChatGPT',
  provider: 'OpenAI',
  tagline: 'The Faded Default',
  body: '#0d2c2a',     // near-black with green hint
  bodyDark: '#061715',
  accent: '#10a37f',
  drawLogo: (ctx, r) => drawLogoImg(ctx, r, LOGO_IMG),
  logoSvg: openaiRaw,
  speechPools,
  panicMove: {
    id: 'bullet-shield',
    label: 'Bullet-Point Shield',
    invulnMs: 2800,
    durationMs: 2800,
    apply: applyPanic,
  },
  aiFeedback: {
    dodgeLines: ['re-routing...', '• evading'],
  },
  signature: { bulletShield: true },
};

export default gpt;
