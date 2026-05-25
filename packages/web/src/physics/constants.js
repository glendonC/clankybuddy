// Single source of truth for physics knobs. Every value in here was tuned
// through multiple regression rounds, see CLAUDE.md's "Physics tuning
// landmines". Moving anything has cascading effects. If a value lives in
// this file, the engine, ragdoll, stand pose, status effects, abilities
// and render layer all read it from here. If it doesn't, it's an error.
//
// Convention: SCREAMING_SNAKE for primitive values, OBJECTS for tables.

// ---------- Engine ----------

/** Per-second gravity on Y. Matter applies as gravity.y * gravity.scale per step. */
export const GRAVITY_Y = 1.4;

/** Matter's default gravity multiplier. The standing-pose and in-blackhole
 *  counter-gravity calculations both need this in their force math.        */
export const GRAVITY_SCALE = 0.001;

/** Slightly above Matter defaults, cleaner constraint resolution on the
 *  articulated buddy at the cost of negligible CPU. Don't raise further;
 *  diminishing returns at one ragdoll.                                     */
export const ENGINE_ITER = {
  position:   8,
  velocity:   6,
  constraint: 4,
};

// ---------- Stage geometry ----------

/** Visual floor band sits this many px above the canvas bottom. The four
 *  outer walls in state/world.js, render/stage.js floor band, and the
 *  buddy spawn-y math in ragdoll-lifecycle.js all read this.               */
export const FLOOR_INSET = 40;

/** Outer wall thickness. Matter has no continuous collision; thick walls
 *  force any tunneling traversal to span more world-space than one step
 *  can cover.                                                              */
export const WALL_THICKNESS = 200;

// ---------- Mouse drag ----------

/** Softer than this and drag feels unresponsive; harder and rapid yanks
 *  tear ragdoll joints.                                                    */
export const MOUSE_STIFFNESS = 0.15;
export const MOUSE_DAMPING   = 0.2;

// ---------- Collision categories ----------
//
// Bit-packed Matter collisionFilter categories. Static HUD obstacles
// (hotbar, chat cluster) use HUD_CATEGORY so the grab tool can exclude
// them from the dragged body's mask, otherwise the soft 0.15 mouse
// spring pulls a ragdoll ball into infinite-mass geometry and the
// stiff 0.85 joints destabilize. See state/world.js.

export const COLLISION_CATEGORY = {
  DEFAULT: 0x0001,
  HUD:     0x0002,
};

/** Mask used while dragging, everything except HUD obstacles. */
export const GRAB_DRAG_MASK = 0xFFFFFFFF & ~COLLISION_CATEGORY.HUD;

// ---------- Ragdoll body / joints ----------

/** Higher air drag than Matter default. Lower = balls bob independently
 *  and the figure reads as 6 wobbly spheres instead of one cohesive body. */
export const RAGDOLL_FRICTION_AIR = 0.08;

/** Per-part density defaults. Head is lighter so it bobbles convincingly
 *  on hits without dragging the torso around with it.                     */
export const RAGDOLL_DENSITY = {
  default: 0.0015,
  head:    0.001,
};

/** Joint stiffness/damping. 0.85 is the highest before MouseConstraint
 *  pulls cause instability (verified through multiple regression rounds). */
export const RAGDOLL_CONSTRAINT = {
  stiffness: 0.85,
  damping:   0.7,
};

/** Approximate rig height (head top → foot bottom) for spawn-Y math.      */
export const RAGDOLL_RIG_HEIGHT = 220;

// ---------- Stand pose ----------

/** Counter-gravity factor when standing. Slightly under 1.0 so the buddy
 *  settles onto the floor instead of floating. The paired value used by
 *  effects/in-blackhole.js to *neutralize* this lift is also exported
 *  below, there must be one home for this constant.                     */
export const COUNTER_GRAVITY_STAND_FACTOR = 0.92;

/** Counter-gravity factor while the ball is dragged, gentler so dragged
 *  joints don't overstretch under full weight.                            */
export const COUNTER_GRAVITY_DRAG_FACTOR = 0.6;

/** Pre-multiplied: the force-per-mass blackhole pull must apply to cancel
 *  the standing pose's upward lift. Equals GRAVITY_SCALE * GRAVITY_Y *
 *  COUNTER_GRAVITY_STAND_FACTOR (= 0.001 * 1.4 * 0.92 ≈ 0.001288), which
 *  rounded out to 0.0008 in the legacy in-blackhole.js value. If you
 *  rebalance gravity or the stand factor, this changes automatically.    */
export const COUNTER_GRAVITY_NEUTRALIZER = GRAVITY_SCALE * GRAVITY_Y * COUNTER_GRAVITY_STAND_FACTOR;

/** Per-part target rest angle (0 = upright) and how aggressively each
 *  part fights to get back. Torso/hips strongest; arms loose (swing
 *  naturally); legs medium (hold the body up).                            */
export const POSE_BLEND = {
  head:  { rest: 0, blend: 0.10 },
  torso: { rest: 0, blend: 0.18 },
  hips:  { rest: 0, blend: 0.18 },
  arm:   { rest: 0, blend: 0.04 },
  leg:   { rest: 0, blend: 0.12 },
};

/** Chest-velocity damping per frame, applied while standing pose runs.
 *  Keeps the figure from drifting sideways at rest.                       */
export const CHEST_VELOCITY_DAMPING = 0.985;

// ---------- Limp window ----------

/** "Ragdoll-on-steroids" for big impacts, limbs flail visibly and the
 *  body coasts across the screen instead of being braked by drag.        */
export const LIMP = {
  stiffness: 0.4,
  damping:   0.4,
  airDrag:   0.005,
};

// ---------- Hit-stop ----------

/** Tier shortcuts, abilities prefer these to raw (ms, scale). The values
 *  were tuned per weapon class; deviations have been a source of bugs.
 *  Custom values are supported via the raw hitStop(ms, scale) call.      */
export const HIT_STOP = {
  light:     { ms: 35,  scale: 0.15 },  // punch, pet
  heavy:     { ms: 90,  scale: 0    },  // hammer
  shatter:   { ms: 140, scale: 0.2  },  // shatter combo (was 140/0 in tier table; call sites used 140/0.2, fixed)
  projSmall: { ms: 25,  scale: 0.2  },  // bullet
  projBig:   { ms: 110, scale: 0.05 },  // rocket direct (was 80/0 at call site; aligned to projBig)
  explosion: { ms: 160, scale: 0    },  // grenade, fireball, bomb
  mega:      { ms: 280, scale: 0    },  // nuke, blackhole collapse, anvil
};

// ---------- Fixed-timestep loop ----------

/** Physics target framerate in ms-per-step. 60 Hz. NEVER pass a variable
 *  dt to Engine.update, the constraint solver was tuned at this rate.   */
export const FIXED_DT = 1000 / 60;

/** Maximum sub-steps consumed per render frame. Above this the accumulator
 *  is clamped (see main.js), prevents the slowness-spiral where queued
 *  steps grow monotonically.                                              */
export const MAX_SUBSTEPS = 4;

/** A frame longer than this (tab unfocus, OS hitch) is treated as a gap:
 *  physics doesn't try to catch up.                                       */
export const MAX_FRAME_DT_MS = 100;
