// Animated brand-title component used on every "front door" screen
// (age-gate, welcome, future verify card). The palette is drawn from the
// canonical persona brand colors in `packages/web/src/personas/*.js` so
// the title visually telegraphs which AIs the buddy can become before
// the user ever picks one.
//
// Animation: ink-gradient accepts a `colors` array; we rotate that array
// by one slot every SHIMMER_INTERVAL_MS, which produces a continuous
// color-wave sweeping across the letters. The palette is palindromic
// (cool → warm → cool) so the wraparound has no visible seam — the wave
// just keeps washing across.
//
// Persona color sources:
//   - ChatGPT teal   #10a37f  (gpt.js accent)
//   - Llama blue     #0866ff  (llama.js body — Meta blue)
//   - DeepSeek indigo #4d6bfe (deepseek.js body)
//   - Claude coral   #d97757  (claude.js body — Anthropic coral)
//
// Grok (#1a1a1a) and Gemini (#3370ff, too close to Llama) are intentionally
// excluded — adding them muddies the wave or drops a black stop into the
// middle of the gradient. If you want representation parity later, swap
// Llama for Gemini and use Grok's accent (#ffffff) as a brief highlight.

import BigText from 'ink-big-text';
import Gradient from 'ink-gradient';
import { useEffect, useState } from 'react';

const PERSONA_PALETTE = [
  '#10a37f', // ChatGPT teal
  '#0866ff', // Llama Meta blue
  '#4d6bfe', // DeepSeek indigo
  '#d97757', // Claude coral
  '#4d6bfe', // DeepSeek indigo (palindrome mirror)
  '#0866ff', // Llama blue (mirror)
  '#10a37f', // ChatGPT teal (mirror)
];

// 140ms per stop × 7 stops ≈ 980ms full cycle. Slow enough to feel premium,
// fast enough to feel alive. Don't go below ~100ms — terminal redraws get
// choppy and the eye loses the wave coherence.
const SHIMMER_INTERVAL_MS = 140;

type Font =
  | 'block' | 'slick' | 'tiny' | 'grid' | 'pallet' | 'shade'
  | 'simple' | 'simple3d' | 'simpleBlock' | '3d' | 'huge';

export function ShimmerTitle({
  text,
  font = 'tiny',
}: {
  text: string;
  font?: Font;
}) {
  const [offset, setOffset] = useState(0);
  useEffect(() => {
    const id = setInterval(() => {
      setOffset((o) => (o + 1) % PERSONA_PALETTE.length);
    }, SHIMMER_INTERVAL_MS);
    return () => clearInterval(id);
  }, []);

  const colors = [
    ...PERSONA_PALETTE.slice(offset),
    ...PERSONA_PALETTE.slice(0, offset),
  ];

  return (
    <Gradient colors={colors}>
      <BigText text={text} font={font} />
    </Gradient>
  );
}
