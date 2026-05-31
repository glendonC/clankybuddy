// Scheduler (S4). The ONLY place timed, repeating ability work is driven from
// sim-time instead of setTimeout. A task fires stepFn(ctx, i) at K absolute
// due-stamps; tickScheduler runs once per render frame from main.js (BETWEEN
// Engine.updates, never inside the FIXED_DT loop), exactly like tickHitStop and
// tickConstraintRegistry. First consumer: creeping barrage (walks K mortar
// shells along a line).
//
// WHY NOT setTimeout: backgrounded tabs throttle setTimeout to >=1s, which would
// stretch a timed barrage into minutes and fire shells on a long-dead buddy (the
// CLAUDE.md backgrounded-tab landmine). Absolute due-stamps + a per-frame tick
// are immune: a skipped frame just makes the next tick fire every now-due step
// (catch-up), keeping the walk on its authored sim-time schedule. tickScheduler
// receives the UNCLAMPED frame `now` (performance.now()); the physics frame-dt
// clamp does not apply to it. The catch-up dump is bounded by `count` and gated
// by the per-task epoch cancel below, so it can never spin or fire on a new buddy.
//
// EPOCH: each task captures epoch=getEpoch() at schedule time. Every tick checks
// getEpoch() !== task.epoch and CANCELS the task on mismatch (never fires a step
// on a new buddy after a character switch). The stepFn also gets a fresh,
// epoch-current ctx, but the task-level cancel means it never even runs post-switch.
//
// FRESH ctx PER STEP: tickScheduler builds ctx=makeCtx() for EACH fired step.
// makeCtx is the bare abilityCtx FACTORY (main.js passes `abilityCtx`, not
// `abilityCtx()`), so the ctx reads the CURRENT buddy. The stepFn closure carries
// its own cast-time data (e.g. posX[i]) and stamps _verb on whatever body it
// spawns — the fresh ctx has no x/y/_verb. Mirrors transients/index.js ctxForTransient.
//
// IMPORT CYCLE: imports getEpoch from ragdoll-lifecycle.js. Benign — only CALLED
// inside fn bodies, never at module top level (same contract as constraint-registry.js).
// Do NOT call getEpoch() at module top level here.
//
// OWNS NO BODIES: a task is a pure timer. The bodies its stepFns spawn are owned
// by transientBodies/cleanupTransients as usual; cancel is just a Map delete.

import { getEpoch } from './ragdoll-lifecycle.js';

// handle (int) -> { stepFn, count, due:number[], firedCount, epoch }
const tasks = new Map();
let _seq = 0;

// Schedule `count` calls of stepFn at absolute sim-time due-stamps:
//   due[i] = baseT + startDelayMs + i*intervalMs,  baseT = performance.now()
// Returns an opaque integer handle (0 = nothing scheduled). Captures the current
// epoch so a later character switch cancels it.
export function scheduleSequence(stepFn, { count, intervalMs, startDelayMs = 0 } = {}) {
  if (typeof stepFn !== 'function' || !(count > 0)) return 0;
  const baseT = performance.now();
  const due = new Array(count);
  for (let i = 0; i < count; i++) due[i] = baseT + startDelayMs + i * intervalMs;
  const handle = ++_seq;
  tasks.set(handle, { stepFn, count, due, firedCount: 0, epoch: getEpoch() });
  return handle;
}

// IDEMPOTENT: safe to call twice / after auto-cancel / on an unknown handle.
// Delete is the only effect (no Matter body to release).
export function cancelScheduled(handle) {
  if (!tasks.has(handle)) return;
  tasks.delete(handle);
}

// Bulk cancel — called as the second first-line of spawnRagdoll (after
// teardownAllConstraints) so a new buddy starts with an empty scheduler the
// instant it spawns. Defense: the per-frame epoch check already blocks firing,
// this just reclaims the entries immediately. Runs under the OLD epoch, correct.
export function cancelAllScheduled() {
  tasks.clear();
}

// Per-frame driver (once per render frame from main.js, BETWEEN Engine.updates).
// Stale-epoch tasks are cancelled, never fired. Live tasks fire every step whose
// due-stamp has elapsed (catch-up: fire ALL due this tick, not one). A fresh ctx
// is built per fired step. A throwing stepFn is caught + logged + its step still
// consumed (firedCount advanced BEFORE the call) so a deterministic throw fires
// once and is skipped, never re-thrown every frame. Doomed handles are collected
// and cancelled AFTER the pass (no mid-iteration Map mutation).
export function tickScheduler(now, makeCtx) {
  if (tasks.size === 0) return;
  const cur = getEpoch();
  const doomed = [];
  for (const [handle, task] of tasks) {
    if (task.epoch !== cur) { doomed.push(handle); continue; }   // stale buddy → never fire
    while (task.firedCount < task.count && task.due[task.firedCount] <= now) {
      const i = task.firedCount;
      task.firedCount++;                  // consume BEFORE calling so a throw can't loop
      try {
        task.stepFn(makeCtx(), i);        // fresh, epoch-current ctx per step
      } catch (err) {
        console.error(`scheduler: step ${i} of task ${handle} threw`, err);
      }
    }
    if (task.firedCount >= task.count) doomed.push(handle);
  }
  for (const h of doomed) cancelScheduled(h);
}

// Dev/test introspection (parallels constraintCount()).
export function scheduledCount() { return tasks.size; }
