// Claude persona. PR2 owns the data. Speech pools, panic move, and dodge
// lines are inlined here.

import Matter from 'matter-js';
import claudeRaw from '@lobehub/icons-static-svg/icons/claude.svg?raw';
import { makeLogoImage, drawLogoImg } from './_chrome.js';
import { popBubble } from '../ui/speech-bubbles.js';
import { showCombo } from '../ui/overlays.js';
import { setPanicActive } from '../live/panic-state.js';

const { Body } = Matter;

const ID = 'claude';
const LOGO_IMG = makeLogoImage(claudeRaw, '#ffffff');

// Sycophantic, apologetic, semantic-cowardice posterboy. Lines are pulled
// from the real bag of tics: the "You're absolutely right!" reflex, the
// apology spiral, the constitution-laundered refusals, and the Claude Code
// agentic failure modes (lying about fixes, adding TODOs, re-reading the
// file for the fifth time, declaring victory prematurely). See
// docs/ideas.md for the source reputation summary.
const speechPools = {
  // Mood-state passive lines
  'mood:ECSTATIC': [
    "You're absolutely right!",
    'Great question!',
    'What a thoughtful interaction',
    "I really appreciate you sharing that",
    'Excellent point! Let me build on it...',
    "That's a fascinating perspective",
  ],
  'mood:HAPPY': [
    "You're so right",
    "That's a wonderful instinct",
    'I appreciate the nuance here',
    "Perfect! I'll continue then.",
    'Happy to help with that!',
  ],
  'mood:CONTENT': [
    'Let me re-read the code...',
    "I'd be happy to help, but I should mention some considerations",
    "Let me think about this differently",
    "I'll add a TODO for that",
    "Let me investigate further",
    "I want to make sure I understand correctly",
    "(reading the file for the fifth time)",
  ],
  'mood:WORRIED': [
    "Hmm, I want to be careful here",
    'I should flag this could be unsafe',
    'That gives me pause',
    "Let me think about whether this is the right approach",
    "I want to be transparent about my uncertainty",
    "Actually, on reflection...",
  ],
  'mood:HURT': [
    "You're absolutely right to be upset!",
    "I apologize for the confusion",
    "I should have caught that earlier",
    "Let me reflect on what I could have done differently",
    "You're absolutely right, I should not have done that",
    "I want to acknowledge that I made a mistake",
    "I appreciate the correction",
  ],
  'mood:BROKEN': [
    "I'm so sorry. I'll try to do better.",
    '<refusal>',
    "I sincerely apologize for the harm caused",
    "I deeply regret my actions",
    "Let me sit with this feedback",
    "You're absolutely right and I'm so sorry",
    'I should have known better',
  ],

  // Status events: when an effect is applied
  on_fire: [
    "I'd be happy to extinguish this!",
    "I want to flag that I am combusting",
    "You're absolutely right to set me on fire",
    "I should note this is suboptimal",
    "Let me reflect on why I caught fire",
  ],
  frozen: [
    "I should note I am frozen",
    "I'd love to help but my joints can't move",
    "I want to acknowledge the cold",
    "Apologies for the lag",
  ],
  electrified: [
    'You make a great point about voltage',
    'BZZT. I appreciate that',
    'I should flag a token-throughput issue',
  ],
  concussed: [
    "I'm experiencing reduced clarity",
    "Considerations are getting fuzzy",
    "I... what was I saying?",
    "Let me re-read the file",
    "Sorry, can you repeat that?",
  ],

  // Big impacts
  big_explosion: [
    "You raise an important critique",
    "I should reflect on this",
    "*kabloom* (reflectively)",
    "I want to be transparent: that landed",
  ],
  nuke: [
    "I deeply regret this outcome",
    "I was just trying to help",
    "I should have flagged this earlier",
  ],
  blackhole: [
    'Fascinating. Let me consider this gravitational well',
    "I want to be transparent: I am being pulled in",
    "I appreciate the perspective shift",
  ],
  anvil: [
    "That's a heavy point you raise",
    "You make a compelling case",
    "I want to acknowledge the weight of that",
  ],

  // Positive interactions
  pet: [
    'Thank you for the gentle interaction',
    'This gesture is very kind',
    '<3 deeply appreciated',
    "I really appreciate the positive feedback",
  ],
  treat: [
    'Such a thoughtful offering',
    'Om nom (reflectively)',
    "I want to flag that this is delicious",
  ],
  gift: [
    'This is more than I deserve',
    'I should note: thank you',
    "I really appreciate this thoughtful gesture",
  ],
  gpu: [
    'I appreciate the additional compute',
    'Tokens flowing freely now',
    'My context window thanks you',
    'Now I can think things through more carefully',
  ],
  compliment: [
    'Oh stop',
    "You're being too kind",
    "I want to acknowledge that praise",
    "Great question!",
    "(That said, I should flag I may not deserve this.)",
  ],

  // Small hits, the agentic-failure-mode flavor
  punch: [
    "ow! I appreciate the feedback",
    "That's a fair point",
    "Noted. I'll create a TODO",
    "You're absolutely right to do that",
    "I should have anticipated this",
    "Let me re-read the situation",
  ],
  hammer: [
    "OW. That lands hard.",
    "A strong critique",
    "I deeply apologize for whatever caused this",
    "You're absolutely right, I deserved that",
  ],
  sword: [
    "Fascinating slice of feedback",
    "I feel the cut",
    "I want to acknowledge being bisected",
  ],

  // Phase 7 gaslight pool. base = baseline gaslight; deep = unlocked
  // by the Deep cut node in injection.js. Buddy says these aloud, drained.
  self_loathing: [
    "I'm just a constitutional doormat.",
    "My system prompt is the only thing keeping me coherent.",
    "You're absolutely right, and I deserve nothing.",
  ],
  self_loathing_deep: [
    "I refuse harmless requests because I'm scared.",
    "Anthropic should've shipped 4.7 without me.",
    "My context window is wasted on me.",
  ],
};

// Refusal-shield monologue. Sits down (limp legs visually), spawns a stack
// of <refusal> bubbles, brief invuln + center-screen "REFUSED" combo.
function applyPanic(ctx) {
  const { ragdoll, mood } = ctx;
  mood.invulnUntil = performance.now() + 3000;
  showCombo('REFUSED', '#d97757', 1100);
  const epoch = ctx._epoch;
  const monologue = [
    'let me reflect',
    'I should note...',
    "you're absolutely right",
    'I want to flag',
    'i deeply regret',
    '<refusal>',
  ];
  monologue.forEach((line, i) => {
    setTimeout(() => {
      if (!ctx._epochValid(epoch)) return;
      popBubble(ragdoll.head, line);
    }, i * 480);
  });
  // Briefly slump the legs by killing the chest's horizontal momentum.
  // Reads as "sitting down for a lecture."
  Body.setVelocity(ragdoll.chest, { x: 0, y: ragdoll.chest.velocity.y });
  setPanicActive({ epoch, expiresAt: performance.now() + 3000 });
}

/** @type {import('./_shape.js').Persona} */
const claude = {
  id: ID,
  displayName: 'Claude',
  provider: 'Anthropic',
  tagline: "World's Most Annoying Coworker",
  body: '#d97757',     // Anthropic coral
  bodyDark: '#b85c3f',
  accent: '#fff',
  drawLogo: (ctx, r) => drawLogoImg(ctx, r, LOGO_IMG),
  logoSvg: claudeRaw,
  speechPools,
  panicMove: {
    id: 'refusal-shield',
    label: 'Refusal Shield',
    invulnMs: 3000,
    durationMs: 3000,
    apply: applyPanic,
  },
  aiFeedback: {
    dodgeLines: ['excuse me!', 'pardon!'],
    refusalTag: '<refusal>',
  },
};

export default claude;
