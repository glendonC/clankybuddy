// ALIGNED, Phase 7+: the producing ability (`alignment_tax`) retired in
// the visceral kit redirect. The status survives as the Compliance Theater
// mode event's producer (modes/events.js, every refusal pays drip currency
// once that hook lands in Chunk E). 30% of incoming attacks auto-block
// (registry.js damageMul reads via `buddyHas('aligned')`).
//
// Visual: pale halo glow under whichever parts carry the status.
// Layer 'under' so the body renders on top of the halo.

export default {
  id: 'aligned',
  defaultDuration: 8000,
  layer: 'under',

  render(rctx, ragdoll, records, now) {
    rctx.save();
    rctx.globalCompositeOperation = 'lighter';
    for (const { part } of records) {
      const t = now * 0.001 + part.id;
      const r = 14 + Math.sin(t * 2) * 2;
      const grad = rctx.createRadialGradient(
        part.position.x, part.position.y, 0,
        part.position.x, part.position.y, r,
      );
      grad.addColorStop(0, 'rgba(255, 248, 220, 0.35)');
      grad.addColorStop(1, 'rgba(255, 248, 220, 0)');
      rctx.fillStyle = grad;
      rctx.beginPath();
      rctx.arc(part.position.x, part.position.y, r, 0, Math.PI * 2);
      rctx.fill();
    }
    rctx.restore();
  },
};
