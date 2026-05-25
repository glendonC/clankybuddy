// Affection group tree. Direct, gentle, low-key positive interactions.
// pet is the free starter. compliment ("glaze") gets a Phase 5 three-
// branch tree per docs/abilities.md §4, A: Earnest (defensive use),
// B: 4o Mode (offensive setup), C: Constitution (Claude-only, deferred
// to Phase 5.5 since it requires the CONSTITUTIONAL status).
// Phase 7, `headpat` cut (was redundant with the pet hold-stroke; the
// AI-tooltip "thinking" bubble landed as cosplay, not gameplay).

import { toolNode, statNode } from './_shared.js';

export default [
  toolNode({
    id: 'g.affection.pet', parents: [], cost: 0, toolId: 'pet',
    label: 'pet',
    blurb: 'Stroke the buddy gently. Drag along the body.',
  }),
  toolNode({
    id: 'g.affection.compliment', parents: ['g.affection.pet'], cost: 50, toolId: 'compliment',
    label: 'glaze',
    blurb: 'Spam praise, combo bonus, escalates the faster you click.',
  }),

  // ── A: Earnest (defensive, sycophancy never triggers; pure +mood) ──
  statNode({
    id: 'g.affection.compliment.earnest', parents: ['g.affection.compliment'], cost: 200, toolId: 'compliment',
    label: 'Earnest',
    blurb: 'Genuine gratitude. Base mood 6 → 10; SYCOPHANCY-FED never applies (defensive build).',
    effect: (s) => { s.base = 10; s.suppressSycophancy = true; },
  }),

  // ── B: 4o Mode (offensive, setup tool into the negative spine) ─────
  statNode({
    id: 'g.affection.compliment.fouro', parents: ['g.affection.compliment'], cost: 200, toolId: 'compliment',
    label: '4o Mode',
    blurb: 'Sycophancy IS the point. Combo cap 12 → 20; chains apply SYCOPHANCY-FED earlier.',
    effect: (s) => { s.comboCap = 20; s.sycophancyTriggerAt = 5; },
  }),
  statNode({
    id: 'g.affection.compliment.sora_glaze', parents: ['g.affection.compliment.fouro'], cost: 600, toolId: 'compliment',
    label: 'Sora Glaze',
    blurb: 'B1, perStep +1.5 → +2.5; deeper buddy debuff stacks faster.',
    effect: (s) => { s.perStep = 2.5; },
  }),

  // C: Constitution (Claude-only; requires CONSTITUTIONAL status) deferred
  // to Phase 5.5, see docs/abilities.md §4.
];
