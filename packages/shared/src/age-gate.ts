// Age-gate single source of truth. Both the web modal and the Ink TUI
// screen import these strings so the legal copy can never drift between
// surfaces. Bump AGE_GATE_VERSION ONLY when the prompt's legal meaning
// changes (e.g. age threshold, added DOB collection, jurisdiction-specific
// re-attestation). Cosmetic copy edits do NOT bump.
//
// On version bump, both surfaces re-prompt because stored.version !==
// AGE_GATE_VERSION. Storage:
//   - web:  localStorage['clankybuddy.age_gate.v1'] (the .v1 suffix is the
//           storage key version, NOT the prompt version; key gets bumped
//           only if the storage shape changes).
//   - TUI:  ~/.clankybuddy/config.json `age_gate: { confirmed_at, version }`
//           inside the v2 config blob.
//
// __clankyReset() (web dev console) does NOT clear age-gate. Age-gate is a
// legal artifact about the human at the device; save state is a game
// artifact about the profile. Independent reset surfaces.

export const AGE_GATE_VERSION = 1;

export const AGE_GATE_TITLE = 'Before you continue';

export const AGE_GATE_PROMPT =
  'ClankyBuddy is intended for users 13 and older. Are you 13 or over?';

export const AGE_GATE_CONFIRM_LABEL = "Yes, I'm 13+";
export const AGE_GATE_DECLINE_LABEL = 'No';

export const AGE_GATE_DECLINE =
  "Thanks for being honest. Come back when you're 13.";

export const AGE_GATE_TOS_HINT =
  'By continuing you accept the Terms of Service and Privacy Policy.';

export type AgeGateRecord = {
  confirmed_at: number; // epoch ms
  version: number; // matches AGE_GATE_VERSION at confirm time
};

// Helper consumed by both surfaces: given a stored record, decide whether
// to skip the prompt. Any version mismatch (or missing record) re-prompts.
export function isAgeGateSatisfied(record: AgeGateRecord | null | undefined): boolean {
  return !!record && record.version === AGE_GATE_VERSION && record.confirmed_at > 0;
}
