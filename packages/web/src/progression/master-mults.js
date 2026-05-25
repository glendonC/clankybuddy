// Cross-cutting multiplier surface kept around as a stub for future use.
// The mastery tree was retired 2026-05-24 (see trees/master.js); no node
// currently mutates these fields, so every read returns 1. Callers
// (mood.js, ui/hotbar.js) keep their `getMasterMul(...) || 1` lookups in
// place so a future global-stat layer can be wired in without re-touching
// the consumers.

const DEFAULT_MASTER = {
  moodMul: 1,
  damageMul: 1,
  shakeMul: 1,
  earnMul: 1,
  comboBonusMul: 1,
};

let masterMultipliers = { ...DEFAULT_MASTER };

export function syncMasterMultipliers(masterStats) {
  masterMultipliers = { ...DEFAULT_MASTER, ...(masterStats || {}) };
}

export function getMasterMul(name) {
  const v = masterMultipliers[name];
  return Number.isFinite(v) ? v : 1;
}
