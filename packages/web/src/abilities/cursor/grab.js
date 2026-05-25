// Grab is owned by Matter's MouseConstraint, see main.js mousedown handler
// (early-return) and the per-frame collisionFilter.mask toggle. This module
// exists so the ability registry has an entry for the tool id and to host the
// cursor visual.
export default {
  id: 'grab',
  apply(/* ctx */) { /* no-op: MouseConstraint handles it */ },
  drawCursor(ctx, { x, y, isDown }) {
    ctx.save();
    ctx.translate(x, y);
    ctx.fillStyle = '#f5d4b8';
    ctx.strokeStyle = 'rgba(0,0,0,0.6)';
    ctx.lineWidth = 1;
    if (isDown) {
      ctx.beginPath(); ctx.ellipse(0, 0, 9, 8, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    } else {
      ctx.beginPath(); ctx.ellipse(0, 4, 8, 10, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      for (let i = 0; i < 4; i++) {
        ctx.beginPath();
        ctx.ellipse(-5 + i * 3.3, -7, 1.5, 6, 0, 0, Math.PI * 2);
        ctx.fill(); ctx.stroke();
      }
      ctx.beginPath(); ctx.ellipse(8, 0, 2.2, 5, 0.5, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    }
    ctx.restore();
  },
};
