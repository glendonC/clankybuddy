// Cursor primitives reused across multiple per-ability cursor draws.

export function drawAimLine(ctx, fromX, fromY, target) {
  if (!target) return;
  ctx.save();
  ctx.strokeStyle = 'rgba(248, 113, 113, 0.5)';
  ctx.lineWidth = 1;
  ctx.setLineDash([5, 5]);
  ctx.beginPath();
  ctx.moveTo(fromX, fromY);
  ctx.lineTo(target.position.x, target.position.y);
  ctx.stroke();
  ctx.setLineDash([]);
  // small reticle on target
  ctx.strokeStyle = 'rgba(248, 113, 113, 0.85)';
  ctx.lineWidth = 1.5;
  const r = (target.circleRadius || 18) + 6;
  ctx.beginPath(); ctx.arc(target.position.x, target.position.y, r, 0, Math.PI * 2); ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(target.position.x - r - 4, target.position.y); ctx.lineTo(target.position.x - r + 2, target.position.y);
  ctx.moveTo(target.position.x + r - 2, target.position.y); ctx.lineTo(target.position.x + r + 4, target.position.y);
  ctx.moveTo(target.position.x, target.position.y - r - 4); ctx.lineTo(target.position.x, target.position.y - r + 2);
  ctx.moveTo(target.position.x, target.position.y + r - 2); ctx.lineTo(target.position.x, target.position.y + r + 4);
  ctx.stroke();
  ctx.restore();
}
