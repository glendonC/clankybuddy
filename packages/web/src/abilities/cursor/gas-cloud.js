// Gas cloud (base) — drop a chemical canister; parts that dwell in the drifting
// cloud start CHOKING (mood bleed + flail + a hard time staying on their feet).
// Root of the gas-cloud fork tree (tear gas / chlorine / cryo fog). All logic
// lives in the shared factory + transient handler; this is just the base skin.
import { makeGasCloud } from './_gas-core.js';

export default makeGasCloud('base');
