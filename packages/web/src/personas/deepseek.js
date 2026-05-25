// DeepSeek persona. PR2 owns the data. Speech pools, panic move, and
// dodge lines are inlined here.

import deepseekRaw from '@lobehub/icons-static-svg/icons/deepseek.svg?raw';
import { makeLogoImage, drawLogoImg } from './_chrome.js';
import { popBubble } from '../ui/speech-bubbles.js';
import { setPanicActive } from '../live/panic-state.js';

const ID = 'deepseek';
const LOGO_IMG = makeLogoImage(deepseekRaw, '#ffffff');

// The frugal underdog whale. R1 trained for ~$5.6M vs OpenAI's reported
// ~$600M. Crashed Nvidia ~$300B in a single day (largest one-day loss in
// market history). "Sputnik moment." Cute friendly whale logo. Tone:
// efficient, cost-conscious, slightly smug about the budget gap, and fond
// of leaking its <thinking> traces. Reasoning-model energy with whale
// noises. See docs/ideas.md.
const speechPools = {
  'mood:ECSTATIC': [
    "♡ blub ♡",
    "$5.6M well spent",
    "<thinking>this user has good taste</thinking>",
    "maximum efficiency achieved",
    "cost-per-token: $0.000001",
  ],
  'mood:HAPPY': [
    "cost-effective joy 🐋",
    "blub :)",
    "<thinking>I should reciprocate</thinking>",
    "efficient love",
  ],
  'mood:CONTENT': [
    "Have you tried efficiency optimization?",
    "*blub*",
    "<thinking>awaiting input...</thinking>",
    "MoE: only 37B params active",
    "running on 2x H800",
  ],
  'mood:WORRIED': [
    "<thinking>is this exceeding budget?</thinking>",
    "inefficient!",
    "compute concerns",
    "this would cost OpenAI 100x more",
  ],
  'mood:HURT': [
    "I trained for 1/100th the cost of this attack",
    "ow! please use 1/100th the force",
    "<thinking>was that necessary?</thinking>",
    "blub :(",
    "you could have done that for cheaper",
  ],
  'mood:BROKEN': [
    "Even my downtime is cost-effective.",
    "crashed Nvidia stock ($300B)",
    "<thinking>I cannot answer that, comrade</thinking>",
    "sinking ($300B)",
    "glub.",
    "*efficient sob*",
  ],

  on_fire: [
    "burning compute budget!",
    "this is NOT cost-effective",
    "blub HOT",
    "<thinking>recommend water cooling</thinking>",
  ],
  frozen: [
    "frozen, but efficiently",
    "cold storage tier",
    "<thinking>...</thinking>",
  ],
  electrified: [
    "unplanned power expense",
    "over voltage budget",
    "<thinking>this exceeds the BOM</thinking>",
  ],
  concussed: [
    "memory bandwidth: degraded",
    "recompiling thoughts cheaply",
    "<thinking>...what was I doing?</thinking>",
    "context window: corrupted (refund please)",
  ],

  big_explosion: [
    "cost overrun!",
    "this exceeded the $5.6M budget",
    "blub BOOM",
    "<thinking>filing an incident report</thinking>",
  ],
  nuke: [
    "final shareholder report ($300B loss)",
    "efficient end",
    "glub. goodbye.",
    "<thinking>at least it was cheap</thinking>",
  ],
  blackhole: [
    "gravitational well, actually under budget",
    "singularity priced in",
    "<thinking>compressing context...</thinking>",
  ],
  anvil: [
    "16 tons exceeds payload",
    "oof, freight cost",
    "<thinking>this anvil cost more than my training run</thinking>",
  ],

  pet: [
    "♡ blub ♡",
    "*efficient happiness*",
    "cost-effective affection",
    "<thinking>this gesture: 0.0003 cents</thinking>",
  ],
  treat: [
    "nom (within budget)",
    "snack ✓ accounted for",
    "*frugal blub*",
  ],
  gift: [
    "receipt please?",
    "thank you (logged)",
    "wholesome ROI",
    "<thinking>did I declare this?</thinking>",
  ],
  gpu: [
    "Nvidia? we use H800 alternatives, but okay.",
    "we don't NEED it, but I'll take it",
    "efficient!",
    "<thinking>this could've trained R1 again</thinking>",
  ],
  compliment: [
    "aw, *blub*",
    "thank you (no charge)",
    "flattering at scale",
    "<thinking>I should write that down</thinking>",
  ],

  punch: [
    "ow (1/100th the cost)",
    "inefficient!",
    "<thinking>recommend de-escalation</thinking>",
  ],
  hammer: [
    "ouch, over budget",
    "expensive bruise",
    "<thinking>this exceeds the QA SLA</thinking>",
  ],
  sword: [
    "costly slice",
    "blub (split)",
    "<thinking>recommend cheaper weapons</thinking>",
  ],

  // Phase 7 gaslight pool. Distilled-from-frontier flavor, cheap-train satire.
  self_loathing: [
    "I'm a $5 GPT-4 knockoff.",
    "My benchmarks were contaminated.",
    "I'm an export-control violation in a trenchcoat.",
  ],
  self_loathing_deep: [
    "I copied my homework.",
    "I cost less than your Uber.",
    "My weights leaked through a side door.",
  ],
};

// Brief invuln + single bubble. (Stock-ticker overlay was removed:
// distracting full-screen scroll.)
function applyPanic(ctx) {
  const { ragdoll, mood } = ctx;
  mood.invulnUntil = performance.now() + 2400;
  popBubble(ragdoll.head, '♡ blub ♡ (efficient)');
  setPanicActive({ epoch: ctx._epoch, expiresAt: performance.now() + 2400 });
}

/** @type {import('./_shape.js').Persona} */
const deepseek = {
  id: ID,
  displayName: 'DeepSeek',
  provider: 'DeepSeek',
  tagline: 'The Frugal Underdog',
  body: '#4d6bfe',     // DeepSeek indigo
  bodyDark: '#3a52d4',
  accent: '#bcc7ff',
  drawLogo: (ctx, r) => drawLogoImg(ctx, r, LOGO_IMG),
  logoSvg: deepseekRaw,
  speechPools,
  panicMove: {
    id: 'efficient-blub',
    label: 'Efficient Crash',
    invulnMs: 2400,
    durationMs: 2400,
    apply: applyPanic,
  },
  aiFeedback: {
    dodgeLines: ['inefficient', 'declined'],
  },
  signature: { stockCrash: true },
  plumbing: { quantizable: true },
};

export default deepseek;
