// Chlorine — a heavier toxic cloud whose choke STACKS the longer the buddy
// stays inside it. The handler bumps the choking rec's intensity on each
// debounced pass (capped), so the mood DoT deepens the longer you dwell.
import { makeGasCloud } from './_gas-core.js';

export default makeGasCloud('chlorine');
