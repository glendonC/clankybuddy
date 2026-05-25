// Tool-cursor renderer. Dispatches to each ability module's `drawCursor`.
// Each ability owns its own cursor visual (co-located with its `apply` logic).

import { getAbility } from '../abilities/index.js';
import { nearestPart } from '../abilities/_shared.js';

export function renderToolCursor(ctx, tool, x, y, ragdoll, isDown, dragStart, gravityY) {
  const a = getAbility(tool);
  if (!a?.drawCursor) return;
  const target = nearestPart(ragdoll, x, y);
  const angle = target ? Math.atan2(target.position.y - y, target.position.x - x) : 0;
  a.drawCursor(ctx, { x, y, target, angle, isDown, dragStart, gravityY });
}
