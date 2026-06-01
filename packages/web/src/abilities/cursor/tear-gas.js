// Tear gas — a drifting irritant cloud that sends the buddy into a blind
// panic-run instead of just choking it. The handler stamps choking with
// data.panic, which makes choking.onTick SWAP the stun-recovery debuff for
// panicRunLeg (the two verbs never co-fire — panicRunLeg bails while stunned).
import { makeGasCloud } from './_gas-core.js';

export default makeGasCloud('tear');
