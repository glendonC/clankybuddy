// Canvas mouse handling: per-tool dispatch (click / hold / drag / hold+drag),
// throttled hold-fire intervals, drag-release for kind:'drag' tools, and
// MouseConstraint grab/release SFX bridging. The per-frame mouseConstraint
// mask toggle lives in main.js's loop (it's read every frame from the active
// tool).

import Matter from 'matter-js';
import { canvas, mouseConstraint } from '../state/world.js';
import { abilityCtx } from '../state/ability-ctx.js';
import { getRagdoll } from '../state/ragdoll-lifecycle.js';
import { applyAbility, applyDragRelease } from '../abilities/index.js';
import { getActiveTool, getActiveToolKind } from '../ui/hotbar.js';
import { TOOLS_BY_ID } from '../ui/tools-table.js';
import { getActiveChar } from '../ui/character-picker.js';
import { earnFromFire } from '../progression/earn.js';
import { emit as emitTelemetry } from '../telemetry/events.js';
import { sfx } from '../audio/sfx.js';

const { Events } = Matter;

// ms between auto-fires while held
const FIRE_INTERVAL = {
  pet: 30,
  flamethrower: 30,
  sword: 50,                      // lightsaber sweep
  machinegun: 70,
};

let isDown = false;
let mouseHover = false;
let lastX = 0, lastY = 0;
let dragStart = null;            // { x, y, t } for kind:'drag' tools (e.g. grenade)
const lastFireMs = {};           // per-tool throttle timestamps

export function getMouseState() {
  return { isDown, mouseHover, lastX, lastY, dragStart };
}

function localPos(e) {
  const r = canvas.getBoundingClientRect();
  return { x: (e.clientX - r.left), y: (e.clientY - r.top) };
}

function fireAbility(tool, x, y, dx, dy) {
  if (!getRagdoll()) return;
  applyAbility(tool, abilityCtx({ x, y, dx, dy, _verb: tool }));
  earnFromFire(tool);
  const meta = TOOLS_BY_ID[tool];
  if (meta) {
    emitTelemetry({
      type: 'tool_fire',
      verb: tool,
      kind: meta.kind,
      spine: meta.spine,
      group: meta.group,
      character: getActiveChar(),
    });
  }
}

// Exported so any modal that takes focus can cancel an in-flight held press,
// otherwise hold-fire (flamethrower / pet) keeps firing while the player is
// browsing menus.
export function endPress() {
  if (isDown) {
    const tool = getActiveTool();
    const kind = getActiveToolKind();
    if (kind === 'drag' && tool !== 'grab' && dragStart) {
      const dx = lastX - dragStart.x;
      const dy = lastY - dragStart.y;
      applyDragRelease(tool, abilityCtx({
        x: dragStart.x, y: dragStart.y, dx, dy, dragVec: { x: dx, y: dy }, _verb: tool,
      }));
      const meta = TOOLS_BY_ID[tool];
      if (meta) {
        emitTelemetry({
          type: 'tool_fire',
          verb: tool,
          kind: meta.kind,
          spine: meta.spine,
          group: meta.group,
          character: getActiveChar(),
          drag_vec: { x: dx, y: dy },
        });
      }
    }
  }
  isDown = false;
  dragStart = null;
}

export function bindMouse() {
  canvas.addEventListener('mousedown', (e) => {
    isDown = true;
    const { x, y } = localPos(e);
    lastX = x; lastY = y;
    const tool = getActiveTool();
    const kind = getActiveToolKind();

    // Grab handled entirely by MouseConstraint
    if (tool === 'grab') return;

    // kind:'drag' (grenade): charge throw, no fire on press
    if (kind === 'drag') {
      dragStart = { x, y, t: performance.now() };
      return;
    }

    // click / hold / hold+drag → fire on press
    fireAbility(tool, x, y, 0, 0);
    lastFireMs[tool] = performance.now();
  });

  canvas.addEventListener('mouseenter', () => { mouseHover = true; });
  canvas.addEventListener('mousemove', (e) => {
    mouseHover = true;
    const { x, y } = localPos(e);
    const dx = x - lastX, dy = y - lastY;
    if (isDown) {
      const tool = getActiveTool();
      const kind = getActiveToolKind();
      if (kind === 'hold' || kind === 'hold+drag') {
        const interval = FIRE_INTERVAL[tool] ?? 50;
        const now = performance.now();
        if ((now - (lastFireMs[tool] || 0)) > interval) {
          fireAbility(tool, x, y, dx, dy);
          lastFireMs[tool] = now;
        }
      }
      // kind:'drag' just tracks position; release handled in mouseup
    }
    lastX = x; lastY = y;
  });

  canvas.addEventListener('mouseup', endPress);
  canvas.addEventListener('mouseleave', () => { mouseHover = false; endPress(); });

  // Mark the ragdoll as "being dragged" while MouseConstraint has it grabbed,
  // so stand.js can skip the upright torque (otherwise the AI fights the
  // user's pull). Also play tactile grab/release SFX.
  Events.on(mouseConstraint, 'startdrag', () => {
    const r = getRagdoll();
    if (r) { r.dragging = true; sfx.grab(); }
  });
  Events.on(mouseConstraint, 'enddrag', () => {
    const r = getRagdoll();
    if (r) { r.dragging = false; sfx.release(); }
  });
}
