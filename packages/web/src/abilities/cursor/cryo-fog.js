// Cryo fog — a freezing vapor: dwell in it long enough and the limb frosts over
// brittle, setting up a shatter. The handler chokes on every pass and, once a
// per-part dwell counter reaches dwellPasses, also stamps the EXISTING `frozen`
// status (reused — slots straight into the brittle→shatter ecosystem).
import { makeGasCloud } from './_gas-core.js';

export default makeGasCloud('cryo');
