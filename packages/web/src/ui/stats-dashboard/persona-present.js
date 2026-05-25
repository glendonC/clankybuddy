import { getPersona, PERSONA_IDS } from '../../personas/index.js';

export { PERSONA_IDS };

export const PERSONA_LABELS = Object.fromEntries(
  PERSONA_IDS.map((id) => [id, getPersona(id).displayName || id]),
);

// Dashboard-tuned persona accents. The game's persona.accent is calibrated for
// the dark stage; these read confidently against the analytics surface.
const PERSONA_PRESENT = {
  claude: '#d97706',
  gpt: '#10a37f',
  gemini: '#4285f4',
  grok: '#525252',
  llama: '#1877f2',
  deepseek: '#6366f1',
};

export function personaAccent(id) {
  return PERSONA_PRESENT[id] || 'var(--ink)';
}

export function personaLogoSvg(id) {
  return getPersona(id)?.logoSvg || '';
}
