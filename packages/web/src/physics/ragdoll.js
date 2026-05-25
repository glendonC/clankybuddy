import Matter from 'matter-js';
import {
  RAGDOLL_DENSITY, RAGDOLL_FRICTION_AIR, RAGDOLL_CONSTRAINT,
} from './constants.js';

const { Bodies, Body, Composite, Constraint } = Matter;

// All-circles ragdoll: head, body, two arm-balls, two leg-balls. The
// reference (classic ball-and-stick ragdoll demo) is just a stack of round
// shapes connected by joints. 6 parts, 5 constraints.
//
// Layout (origin = head center at (x, y)):
//   head    r=36  at (x, y)
//   body    r=44  at (x, y+88)
//   armL    r=22  at (x-66, y+82)
//   armR    r=22  at (x+66, y+82)
//   legL    r=26  at (x-26, y+162)
//   legR    r=26  at (x+26, y+162)
//
// buddyId tags every part so collision dispatch can resolve which buddy a
// hit landed on. With only one buddy on stage today the value is always
// 'main'; Swarm mode will mint distinct ids per crew member.
export function createRagdoll(x, y, character, buddyId = 'main') {
  const group = Body.nextGroup(true);
  const opts = (label) => ({
    collisionFilter: { group },
    density: RAGDOLL_DENSITY.default,
    // Higher air drag = limbs settle quickly instead of jiggling, body
    // reads as one cohesive unit rather than 6 independently-bobbing balls.
    frictionAir: RAGDOLL_FRICTION_AIR,
    friction: 0.7,
    restitution: 0.04,
    label,
    render: { visible: false },
  });

  const head = Bodies.circle(x, y, 36, { ...opts('head'), density: RAGDOLL_DENSITY.head });
  const body = Bodies.circle(x, y + 88, 44, opts('body'));
  const armL = Bodies.circle(x - 66, y + 82, 22, opts('arm'));
  const armR = Bodies.circle(x + 66, y + 82, 22, opts('arm'));
  const legL = Bodies.circle(x - 26, y + 162, 26, opts('leg'));
  const legR = Bodies.circle(x + 26, y + 162, 26, opts('leg'));

  // Stiff joints + heavy damping make the figure feel like one body, not a
  // chain of loose balls. RAGDOLL_CONSTRAINT.stiffness is the highest we
  // can push before MouseConstraint pulls start producing instability.
  const cOpts = { ...RAGDOLL_CONSTRAINT, render: { visible: false } };

  // All anchors are on the OUTER EDGE of the body circle (radius 44):
  //   shoulders ≈ (±42, -14)  → 30° above horizontal at body edge
  //   hips      ≈ (±20,  39)  → 60° below horizontal at body edge
  // Arms/legs anchor on their inner-side edge so balls visibly attach to body.
  const constraints = [
    Constraint.create({ bodyA: head, pointA: { x: 0, y: 32 }, bodyB: body, pointB: { x: 0, y: -42 }, ...cOpts }),
    Constraint.create({ bodyA: body, pointA: { x: -42, y: -14 }, bodyB: armL, pointB: { x:  20, y: 0 }, ...cOpts }),
    Constraint.create({ bodyA: body, pointA: { x:  42, y: -14 }, bodyB: armR, pointB: { x: -20, y: 0 }, ...cOpts }),
    Constraint.create({ bodyA: body, pointA: { x: -20, y:  39 }, bodyB: legL, pointB: { x:  18, y: -18 }, ...cOpts }),
    Constraint.create({ bodyA: body, pointA: { x:  20, y:  39 }, bodyB: legR, pointB: { x: -18, y: -18 }, ...cOpts }),
  ];

  const parts = [head, body, armL, armR, legL, legR];

  head.partType = 'head';
  body.partType = 'torso';
  armL.partType = 'arm'; armR.partType = 'arm';
  legL.partType = 'leg'; legR.partType = 'leg';

  for (const p of parts) p.buddyId = buddyId;

  const composite = Composite.create({ label: 'ragdoll' });
  Composite.add(composite, [...parts, ...constraints]);

  return {
    composite,
    parts,
    head,
    chest: body,
    character,
    bodyMap: { head, body, armL, armR, legL, legR },
  };
}

export function ragdollCenter(ragdoll) {
  let sx = 0, sy = 0;
  for (const p of ragdoll.parts) { sx += p.position.x; sy += p.position.y; }
  return { x: sx / ragdoll.parts.length, y: sy / ragdoll.parts.length };
}
