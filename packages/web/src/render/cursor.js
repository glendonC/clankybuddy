// Tool-cursor renderer. Dispatches to each ability module's `drawCursor`.
// Each ability owns its own cursor visual (co-located with its `apply` logic).

import { getAbility } from '../abilities/index.js';
import { nearestPart, aimAngle, AIMED_FIREARMS } from '../abilities/_shared.js';

export function renderToolCursor(ctx, tool, x, y, ragdoll, isDown, dragStart, gravityY) {
  const a = getAbility(tool);
  if (!a?.drawCursor) return;
  let target, angle;
  if (AIMED_FIREARMS.has(tool)) {
    // Firearms route through aimAngle so the lock-on reticle only shows when
    // the aimbot unlock is owned; otherwise target is null (manual crosshair).
    ({ angle, target } = aimAngle(ragdoll, x, y, 'firearms'));
  } else {
    // Everything else: cursor faces the nearest part (orientation, not aimbot).
    target = nearestPart(ragdoll, x, y);
    angle = target ? Math.atan2(target.position.y - y, target.position.x - x) : 0;
  }
  a.drawCursor(ctx, { x, y, target, angle, isDown, dragStart, gravityY });
}
