let activePanicMove = null;
let lastClearedAt = 0;

// Adversary archetype reads this to know when the 4×-damage window is
// open. The grace period after `clearPanicActive()` lets a fast player
// chain a heavy hit *out of* the panic move, which is the parry game.
const ADVERSARY_GRACE_MS = 1500;

export function setPanicActive(rec) {
  activePanicMove = rec;
}

export function getPanicActive() {
  return activePanicMove;
}

export function clearPanicActive() {
  if (activePanicMove) lastClearedAt = performance.now();
  activePanicMove = null;
}

// Returns true while the buddy is panicking OR within the post-panic grace
// window. Used by mood.js and _shared.js to switch Adversary's damageMul
// between 4× (in window) and 0.25× (outside).
export function panicWindowActive() {
  if (activePanicMove) return true;
  if (lastClearedAt && performance.now() - lastClearedAt < ADVERSARY_GRACE_MS) return true;
  return false;
}
