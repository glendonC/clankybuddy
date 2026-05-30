// Cursor primitives reused across multiple per-ability cursor draws.

// Manual-aim baseline reticle: a plain crosshair at the cursor, no lock-on
// line or target ring. Shown by aimed firearms when the `aimbot` unlock is
// NOT owned (drawAimLine is the assisted-aim counterpart).
export function drawCrosshair(ctx, x, y) {
  ctx.save();
  ctx.strokeStyle = 'rgba(230, 230, 235, 0.6)';
  ctx.lineWidth = 1;
  const r = 7, gap = 2.5;
  ctx.beginPath();
  ctx.moveTo(x - r, y); ctx.lineTo(x - gap, y);
  ctx.moveTo(x + gap, y); ctx.lineTo(x + r, y);
  ctx.moveTo(x, y - r); ctx.lineTo(x, y - gap);
  ctx.moveTo(x, y + gap); ctx.lineTo(x, y + r);
  ctx.stroke();
  ctx.beginPath(); ctx.arc(x, y, 1, 0, Math.PI * 2); ctx.stroke();
  ctx.restore();
}

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
