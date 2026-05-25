// Matter engine + world + canvas + walls + MouseConstraint setup.
// Lives outside main.js so the rest of the engine can import these singletons
// without going through the boot orchestrator.
//
// All physics knobs (gravity, iteration counts, wall thickness, mouse
// stiffness, floor inset, collision categories) live in physics/constants.js.
// Don't hard-code values here.

import Matter from 'matter-js';
import {
  GRAVITY_Y, ENGINE_ITER, FLOOR_INSET, WALL_THICKNESS,
  MOUSE_STIFFNESS, MOUSE_DAMPING, COLLISION_CATEGORY,
} from '../physics/constants.js';

const { Engine, Bodies, Composite, Mouse, MouseConstraint } = Matter;

export const canvas = document.getElementById('game');
export const ctx = canvas.getContext('2d');

export const engine = Engine.create();
engine.gravity.y = GRAVITY_Y;
engine.positionIterations   = ENGINE_ITER.position;
engine.velocityIterations   = ENGINE_ITER.velocity;
engine.constraintIterations = ENGINE_ITER.constraint;
export const world = engine.world;

let walls = [];
function buildWalls() {
  if (walls.length) Composite.remove(world, walls);
  const w = canvas.width, h = canvas.height;
  // Floor is sticky so the buddy plants its feet. Ceiling and side walls
  // are slick so a body launched (or dragged) into them slides back into
  // the playfield instead of pinning under counter-gravity friction.
  // Walls are thick (not 40), Matter has no continuous collision, so thin
  // walls let drag-flung bodies tunnel through. Thick walls force any
  // tunneling traversal to span more world-space than a single physics
  // step can cover.
  const T = WALL_THICKNESS;
  const floorOpts = { isStatic: true, friction: 0.8, restitution: 0.1, render: { visible: false } };
  const slickOpts = { isStatic: true, friction: 0,   restitution: 0.2, render: { visible: false } };
  walls = [
    Bodies.rectangle(w/2, h - FLOOR_INSET + T/2, w + 2*T, T, floorOpts), // floor (inner top at h - FLOOR_INSET)
    Bodies.rectangle(w/2, -T/2,                  w + 2*T, T, slickOpts), // ceiling
    Bodies.rectangle(-T/2,    h/2, T, h + 2*T, slickOpts),               // left
    Bodies.rectangle(w + T/2, h/2, T, h + 2*T, slickOpts),               // right
  ];
  Composite.add(world, walls);
  world.bounds = { min: { x: 0, y: 0 }, max: { x: w, y: h } };
}

// HUD obstacles: invisible static bodies sized from DOM rects of the HUD
// chrome (hotbar, shop slot, bottom-left chat cluster). Keeps the buddy
// from drifting behind UI elements when knocked across the stage. The
// bodies' top surfaces align with each HUD element's top edge, so the
// buddy rests *on* the hotbar rather than vanishing below it.
//
// Important: HUD obstacles live on COLLISION_CATEGORY.HUD. When the grab
// tool is active, main.js flips the dragged body's mask to GRAB_DRAG_MASK
// (HUD bit zeroed) so the soft 0.15 mouse spring can't pull a ragdoll
// ball into infinite-mass HUD geometry, that path destabilizes the
// stiff 0.85 joint solver. The default-mask ragdoll still collides with
// HUD normally; only dragging is filtered.
const HUD_OBSTACLE_SELECTORS = ['#hotbar', '#upgrades-btn', '.hud-bl'];
let hudObstacles = [];
let _hudObserver = null;
let _hudRebuildScheduled = false;
function rebuildHudObstacles() {
  if (hudObstacles.length) Composite.remove(world, hudObstacles);
  hudObstacles = [];
  if (!canvas.width || !canvas.height) return;
  const cr = canvas.getBoundingClientRect();
  const opts = {
    isStatic: true,
    friction: 0.8,
    restitution: 0.05,
    collisionFilter: { category: COLLISION_CATEGORY.HUD, mask: 0xFFFFFFFF },
    render: { visible: false },
  };
  for (const sel of HUD_OBSTACLE_SELECTORS) {
    const el = document.querySelector(sel);
    if (!el) continue;
    const r = el.getBoundingClientRect();
    if (r.width < 4 || r.height < 4) continue;
    const left   = Math.max(0,             r.left   - cr.left);
    const right  = Math.min(canvas.width,  r.right  - cr.left);
    const top    = Math.max(0,             r.top    - cr.top);
    const bottom = Math.min(canvas.height, r.bottom - cr.top);
    const bw = right - left, bh = bottom - top;
    if (bw < 4 || bh < 4) continue;
    hudObstacles.push(Bodies.rectangle(left + bw/2, top + bh/2, bw, bh, opts));
  }
  if (hudObstacles.length) Composite.add(world, hudObstacles);
}
// ResizeObserver fires during layout, which can land mid-physics-step on a
// slow frame. Defer the world mutation to the next rAF so it never races
// with Engine.update.
function scheduleHudRebuild() {
  if (_hudRebuildScheduled) return;
  _hudRebuildScheduled = true;
  requestAnimationFrame(() => {
    _hudRebuildScheduled = false;
    rebuildHudObstacles();
  });
}
function attachHudObserver() {
  if (_hudObserver || typeof ResizeObserver === 'undefined') return;
  _hudObserver = new ResizeObserver(scheduleHudRebuild);
  for (const sel of HUD_OBSTACLE_SELECTORS) {
    const el = document.querySelector(sel);
    if (el) _hudObserver.observe(el);
  }
}

export function resize() {
  const r = document.getElementById('stage').getBoundingClientRect();
  canvas.width = r.width;
  canvas.height = r.height;
  buildWalls();
  rebuildHudObstacles();
  attachHudObserver();
}
window.addEventListener('resize', resize);

// MouseConstraint: stock pattern. The mask is toggled each frame from
// main.js based on the active tool, when grab is active, main.js sets
// the constraint mask to GRAB_DRAG_MASK so the dragged body excludes
// HUD obstacles. When grab is inactive, mask is 0 (non-grabby).
export const mouse = Mouse.create(canvas);
export const mouseConstraint = MouseConstraint.create(engine, {
  mouse,
  constraint: { stiffness: MOUSE_STIFFNESS, damping: MOUSE_DAMPING, render: { visible: false } },
});
Composite.add(world, mouseConstraint);
mouseConstraint.collisionFilter.mask = 0;
