// Render barrel: re-exports the per-pass renderers so main.js has a single
// import surface. (Pass A6 will further wrap this into a `renderFrame`
// orchestrator if useful.)

export { clearStage, spawnImpactDust, renderFloor, renderContactShadow } from './stage.js';
export { renderRagdoll }         from './ragdoll.js';
export { renderTransients }      from './transients.js';
export { renderToolCursor }      from './cursor.js';
