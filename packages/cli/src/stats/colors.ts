// Persona chart palette · centralized in shared/personas.ts, re-exported
// here under the local CHART_COLORS name for backwards-compatibility
// and call-site brevity. See PERSONA_BRAND_HEX for the canonical
// hex-to-persona mapping and the rationale behind the choices.

import {
  PERSONA_BRAND_HEX,
  type ModelId,
} from '../../../shared/src/personas.js';

export const CHART_COLORS: Record<ModelId, string> = PERSONA_BRAND_HEX;
