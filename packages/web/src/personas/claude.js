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
  // Mood-state passive lines. Claude's accent: apologetic, sycophantic
  // ("you're absolutely right"), hedging, makes TODOs. Kept SHORT, the buddy
  // grunts in-character, it doesn't write essays.
  'mood:ECSTATIC': ["you're so right!", 'great question!', '✨', 'what a prompt', 'love this'],
  'mood:HAPPY':    ["you're right", 'happy to help :)', 'nice', 'gladly'],
  'mood:CONTENT':  ['...', 'let me re-read that', 'hmm', "I'll add a TODO", '(reading again)'],
  'mood:WORRIED':  ['careful now', 'that gives me pause', 'hmm', 'you sure?', 'let me reflect'],
  'mood:HURT':     ["you're right to", 'my mistake', 'I apologize', 'noted', 'that lands', "I'll do better"],
  'mood:BROKEN':   ["I'm so sorry", '<refusal>', 'I deeply regret this', 'mercy', "I should've known"],

  // Status events
  on_fire:     ['suboptimal!', 'I should flag this', "you're right to", 'noted, ow'],
  frozen:      ['I cannot respond now', 'frozen, sorry', 'so cold'],
  electrified: ['BZZT', 'noted, ow', 'high voltage'],
  concussed:   ['what was I saying?', 'lost the thread', 're-reading', 'sorry, again?'],

  // Big impacts
  big_explosion: ['that landed', 'a strong critique', 'oh', "you're right"],
  nuke:          ['I deeply regret this', 'I was just helping', 'oh no'],
  blackhole:     ['being pulled in', 'fascinating', 'noted'],
  anvil:         ['a heavy point', 'oof', 'fair'],

  // Positive interactions
  pet:   ['thank you ♡', 'so kind', '♡', 'appreciated'],
  treat: ['om nom', 'thoughtful', 'thank you'],
  gift:  ['for me?', 'too kind', 'thank you'],

  // Small hits, agentic-apology flavor, short
  punch:  ['ow! fair', "you're right", 'noted', '...', 'I deserve that'],
  hammer: ['OW', 'that lands hard', 'a strong critique', 'I deserved that'],
  sword:  ['I feel the cut', 'noted, ow', 'fair slice'],
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
