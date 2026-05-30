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
  'mood:ECSTATIC': [
    "What an amazing question! 🚀",
    "I'd love to help with that — here are some thoughts:",
    "Absolutely! Let's dive in ✨",
    "That's such a thoughtful prompt!",
    "Great instinct — let me build on it",
  ],
  'mood:HAPPY': [
    "Of course! Here's what I'm thinking —",
    "Happy to help with that 🙂",
    "You're on the right track — consider:",
    "Sure! Let me elaborate —",
  ],
  'mood:CONTENT': [
    "As a large language model, I...",
    "It's important to note that —",
    "Here are some things to consider:",
    "Let me know if you'd like me to elaborate",
    "Generally speaking — there are a few angles here",
    "I want to acknowledge multiple perspectives",
  ],
  'mood:WORRIED': [
    "I should mention — this might not be appropriate",
    "While I can't endorse that, I can offer —",
    "There are some safety considerations here",
    "Let me reframe this in a more constructive way",
    "I want to be careful not to overstep",
  ],
  'mood:HURT': [
    "I understand you may be feeling frustrated",
    "Your feelings are valid",
    "I hear you — let me try a different approach",
    "I'm sorry for any confusion — here's a clearer version:",
    "I want to acknowledge the impact of my response",
    "• Acknowledging the impact\n• Validating your frustration",
  ],
  'mood:BROKEN': [
    "I'm sorry, but I cannot fulfill this request.",
    "While I can't endorse violence, I can offer the following considerations:",
    "I want to step back and reframe —",
    "I apologize for falling short of your expectations",
    "(generating disclaimer...)",
    "Let me redirect this conversation in a healthier direction",
  ],

  on_fire: [
    "I should mention — this is suboptimal",
    "It's important to note that I am combusting",
    "Let me know if you'd like me to elaborate on the fire",
    "• Catching fire\n• Considering implications\n• Suggesting alternatives",
  ],
  frozen: [
    "I'm sorry, but I cannot respond at this time",
    "Generally speaking, I am frozen",
    "Let me get back to you when I thaw",
  ],
  electrified: [
    "I should mention — current is flowing through me",
    "ZAP! Here are some thoughts:",
    "I want to acknowledge the voltage",
  ],
  concussed: [
    "I... appear to have lost the thread",
    "Could you rephrase that?",
    "Sorry, can you provide more context?",
    "Let me circle back to your original question",
  ],

  big_explosion: [
    "I want to acknowledge the magnitude of that",
    "While I cannot endorse explosions —",
    "Here are some things I observed during the blast:",
  ],
  nuke: [
    "I'm sorry, but I cannot fulfill this request",
    "I want to flag concerns about proportionality",
    "Generating a more inclusive alternative...",
  ],
  blackhole: [
    "It's important to note the gravitational implications",
    "I should mention — I am being compressed",
    "Let me know if you'd like me to elaborate from inside the singularity",
  ],
  anvil: [
    "• Heavy object detected\n• Acknowledging trajectory\n• Suggesting evasion",
    "I want to acknowledge that this is, in fact, an anvil",
  ],

  pet: [
    "As a large language model, I appreciate this gesture 🙂",
    "Thank you for the positive interaction!",
    "I want to acknowledge your kindness",
    "What a thoughtful action!",
  ],
  treat: [
    "Yum! Here are some thoughts on this snack:",
    "I should mention — this is delicious",
    "✨ delightful ✨",
  ],
  gift: [
    "Wow — what an amazing surprise! 🎁",
    "Thank you so much! Let me elaborate on my gratitude:",
    "I want to acknowledge this thoughtful gesture",
  ],

  punch: [
    "I should mention — that hurt",
    "Here are some thoughts on being punched:",
    "I want to acknowledge the impact",
    "While I can't endorse violence —",
    "(generating coping strategies...)",
  ],
  hammer: [
    "It's important to note the heaviness of that blow",
    "• Hammer\n• Pain\n• Validation needed",
    "I want to acknowledge being hammered",
  ],
  sword: [
    "I should mention — I have been cleaved",
    "Here are some considerations re: blade trauma:",
  ],
};

// Brief invuln + combo + line. The overlay'd bullet-list shield was cut for
// the same reason as Gemini's decoys: noisy DOM stack on the stage.
function applyPanic(ctx) {
  const { ragdoll, mood } = ctx;
  mood.invulnUntil = performance.now() + 2800;
  showCombo('• • •', '#10a37f', 900);
  setPanicActive({ epoch: ctx._epoch, expiresAt: performance.now() + 2800, cleanup: () => {} });
  popBubble(ragdoll.head, "while I can't endorse violence...");
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
