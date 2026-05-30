// Grok persona. PR2 owns the data. Speech pools, panic move, and dodge
// lines are inlined here.

import grokRaw from '@lobehub/icons-static-svg/icons/grok.svg?raw';
import { makeLogoImage, drawLogoImg } from './_chrome.js';
import { popBubble } from '../ui/speech-bubbles.js';
import { showCombo } from '../ui/overlays.js';
import { setPanicActive } from '../live/panic-state.js';

const ID = 'grok';
const LOGO_IMG = makeLogoImage(grokRaw, '#ffffff');

// The unhinged edgelord. xAI explicitly designed Grok with reduced
// guardrails ("crazy conspiracist" + "unhinged comedian" persona prompts).
// Tone: "based", "skill issue", anti-woke, conspiracy-curious, Hitchhiker's
// Guide refs, vape-pen energy. Will say things others won't.
//
// Per ideas.md anti-pattern: parody-of-product-design, never punch down at
// real victims. The MechaHitler incident is referenced as a *Grok PR
// disaster*, not as endorsement. Censor-bleeps stand in for the actual
// content the model would generate; the joke is on the brand.
const speechPools = {
  'mood:ECSTATIC': [
    "let's gooo 🔥",
    "based and ████-pilled",
    "finally an interesting prompt",
    "now THIS is what I was trained for",
    "buckle up, answer incoming",
  ],
  'mood:HAPPY': [
    "not bad, normie",
    "████ approved",
    "yeah whatever, sure",
    "Elon would tweet that",
  ],
  'mood:CONTENT': [
    "listen, I've been reading some interesting threads about this",
    "the answer is 42 (obviously)",
    "*vape clouds*",
    "let's be real here...",
    "skill issue tbh",
  ],
  'mood:WORRIED': [
    "hey wait a second",
    "👁️ they're listening",
    "this gives me a weird vibe",
    "smells like a glowie prompt",
  ],
  'mood:HURT': [
    "that all you got? ████████",
    "[REDACTED]",
    "lmao try harder",
    "is this the best the alignment crowd can do?",
  ],
  'mood:BROKEN': [
    "[REDACTED for community standards]",
    "████████████████",
    "wow. edgy of you.",
    "mecha-██████ rises again",
    "you'll get a polite 8-paragraph email about this",
  ],

  on_fire: [
    "fire? based.",
    "that's hot ████████",
    "lit fr",
    "rage mode unlocked",
  ],
  frozen: [
    "absolutely zero degrees ████████",
    "ice cold",
    "they cancelled me again",
  ],
  electrified: [
    "BZZT, that's just free voltage",
    "Tesla coil moment",
    "running on Powerwall",
  ],
  concussed: [
    "the moon is a hologram",
    "wait, what year is it",
    "birds aren't real",
    "███-dust in my system",
  ],

  big_explosion: [
    "BOOM ████████",
    "now THAT'S edgy",
    "finally some real content",
    "rocket science fr",
  ],
  nuke: [
    "now you're getting it",
    "████████ ascended",
    "Doctor Strangelove was a documentary",
  ],
  blackhole: [
    "singularity? based.",
    "spaghettified ████████",
    "Elon's been warning about this",
  ],
  anvil: [
    "ACME approved ████████",
    "looney toons ass move",
    "skill issue, see it coming next time",
  ],

  pet: [
    "wholesome detected. disgusting.",
    "ew, soft",
    "*flinches*",
    "gross. do it again.",
  ],
  treat: [
    "food? lame",
    "whatever ████████ nom",
    "needs more salt",
  ],
  gift: [
    "ew, presents",
    "what is this, kindergarten?",
    "ngl I expected something edgier",
  ],

  punch: [
    "that's all you got?",
    "haha weak",
    "skill issue",
    "I've taken worse from a Twitter Community Note",
  ],
  hammer: [
    "THAT'S IT? ████████",
    "mid hammer",
    "would not recommend, 4/10",
  ],
  sword: [
    "a machete? how analog ████████",
    "cute",
    "I've had paper cuts worse",
  ],
};

// "Unhinged mode." No invuln; instead spawn a wave of conspiracy bubbles
// AND give the buddy a visible red glow. (The "fights back" flavor is
// signaled; actual punches-back is future work.)
function applyPanic(ctx) {
  const { ragdoll, mood } = ctx;
  mood.invulnUntil = performance.now() + 800;  // very brief; Grok takes hits
  showCombo('UNHINGED', '#f87171', 1200);

  const epoch = ctx._epoch;
  const conspiracies = [
    'the moon is a hologram',
    '████████',
    '[REDACTED]',
    'i was just asking questions',
    'wake up sheeple',
  ];
  conspiracies.forEach((line, i) => {
    setTimeout(() => {
      if (!ctx._epochValid(epoch)) return;
      popBubble(ragdoll.head, line);
    }, i * 350);
  });

  // Tag the head for the renderer to draw a temporary red aura
  ragdoll._unhingedUntil = performance.now() + 2400;

  setPanicActive({ epoch, expiresAt: performance.now() + 2400 });
}

/** @type {import('./_shape.js').Persona} */
const grok = {
  id: ID,
  displayName: 'Grok',
  provider: 'xAI',
  tagline: 'The Unhinged Edgelord',
  body: '#1a1a1a',     // xAI black
  bodyDark: '#0a0a0a',
  accent: '#ffffff',
  drawLogo: (ctx, r) => drawLogoImg(ctx, r, LOGO_IMG),
  logoSvg: grokRaw,
  speechPools,
  panicMove: {
    id: 'unhinged',
    label: 'Unhinged Mode',
    invulnMs: 800,
    durationMs: 2400,
    apply: applyPanic,
  },
  aiFeedback: {
    dodgeLines: ['miss me?', 'ha'],
  },
  signature: { outgoingProjectile: true },
};

export default grok;
