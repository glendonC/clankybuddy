// Single source of truth for the persona/model id roster. Worker's
// VALID_MODELS, web client's persona registry, and event-schema model
// fields all derive from this constant. Adding a 7th model = append id
// here, create src/personas/<id>.js, deploy worker. No other change.
//
// The literal tuple is a freeze contract. Tests assert these specific
// strings to prevent silent drift between save files (which key on
// these strings) and shipped code.
export const PERSONA_IDS = ['claude', 'gpt', 'gemini', 'grok', 'llama', 'deepseek'] as const;
export type ModelId = (typeof PERSONA_IDS)[number];
export const PERSONA_ID_SET: ReadonlySet<ModelId> = new Set(PERSONA_IDS);
export const isModelId = (s: string): s is ModelId => PERSONA_ID_SET.has(s as ModelId);

// Brand colors for UI chrome that wants to identify a persona at a glance
// (TUI stats chart, web persona picker hover state, future leaderboard
// pills). These mirror the `body` color in packages/web/src/personas/*.js
// EXCEPT for personas whose body is near-black (gpt, grok), for those we
// take the `accent` color instead so the persona is legible on dark UI.
//
// Llama keeps its lighter accent (#62c3ff) rather than the Meta deep-blue
// body because gemini's body (#3370ff) already occupies that slot and the
// two would be indistinguishable on a dark terminal.
//
// Single source of truth for cross-package consumers. Web personas/*.js
// remain authoritative for chrome/logo work; this map is a curated
// projection for "what color represents this persona in a single dot."
export const PERSONA_BRAND_HEX: Record<ModelId, string> = {
  claude:   '#d97757', // Anthropic coral
  gpt:      '#10a37f', // ChatGPT teal (accent; body is near-black)
  gemini:   '#3370ff', // Google blue
  grok:     '#ffffff', // xAI white  (accent; body is near-black)
  llama:    '#62c3ff', // Meta light-blue accent (body conflicts with gemini)
  deepseek: '#4d6bfe', // DeepSeek indigo
};
