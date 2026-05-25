// FORCE_QUIT_ACTIVE, applied by `force_quit` for 1.5s. While active:
//   - damageMul returns 0 (intangible, incoming damage voided)
//   - render hooks cut body alpha to ~12%
//   - panic-moves gate (shared with self_loathing) suppresses panic
// On natural expiry the ability's setTimeout closure fires the mood wipe.
// Phase 7 visceral-redirect.
//
// Stored on head only (buddy-wide intangibility, checked via buddyHas).
// Layer 'over' so the alpha-reduction overlay reads above the body.

export default {
  id: 'force_quit_active',
  defaultDuration: 1500,
  layer: 'over',

  render(rctx, ragdoll, records, now) {
    if (!records.length) return;
    // Fade the whole stage area around the buddy to dramatic effect.
    rctx.save();
    rctx.fillStyle = 'rgba(8, 8, 12, 0.55)';
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const p of ragdoll.parts) {
      minX = Math.min(minX, p.position.x - 30);
      minY = Math.min(minY, p.position.y - 30);
      maxX = Math.max(maxX, p.position.x + 30);
      maxY = Math.max(maxY, p.position.y + 30);
    }
    if (Number.isFinite(minX)) {
      rctx.fillRect(minX, minY, maxX - minX, maxY - minY);
    }
    // Glitchy scanline strip across the bounding box.
    rctx.globalAlpha = 0.35;
    rctx.fillStyle = '#ff3838';
    const phase = (now * 0.06) % (maxY - minY || 100);
    rctx.fillRect(minX, minY + phase, maxX - minX, 2);
    rctx.restore();
  },
};
