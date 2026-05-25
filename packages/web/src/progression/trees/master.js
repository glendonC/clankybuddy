// MASTER tree, retired 2026-05-24.
//
// History: Phase 6 shipped 5 mutually-exclusive prestige archetypes
// (Petter / Adversary / Sycophant / Researcher / Whale) here, which
// themselves replaced the 5 unconditional multiplier nodes from Phase 5.
// Both generations reduced to "stat sticks wearing identity costumes"
//, they amplified or restricted existing verbs instead of giving the
// player new ones. Per design call (see memory: no meta-progression
// above the shop), the slot is deleted, not refilled. All progression
// depth lives in the group trees under `progression/groups/`.
//
// The five archetype ids (master.archetype.petter / adversary / sycophant
// / researcher / whale) are listed in REMOVED_NODE_COSTS for 1:1 refund
// on next save load.
//
// This file exports an empty array so trees/index.js continues to build
// its registry without changes. Delete the file entirely once the slot-
// picker stops importing MASTER_TREE (next breadth/depth pass).

export default [];
