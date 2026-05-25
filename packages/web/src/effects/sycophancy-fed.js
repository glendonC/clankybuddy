// SYCOPHANCY-FED, applied when the buddy is over-praised. Producers:
//   - `compliment` (glaze) chains 3+ casts in ~2s
//   - `sycophancy_bait` (Phase 4) on its 5th chain
// Effect: incoming mood damage ×1.5 (extended in registry.js damageMul).
// The over-praised model is brittle. Reference: Stanford 2025 sycophancy
// benchmark, 58% of Claude responses; weaponized as a debuff for the
// AI, not the player.
//
// Visual: drifting pink hearts arcing upward from the part. Layered
// 'over' so they read on top of the body.

export default {
  id: 'sycophancy_fed',
  defaultDuration: 3000,
  layer: 'over',

  onApply(part, rec) {
    rec._heartPhase = Math.random() * Math.PI * 2;
  },

  render(rctx, ragdoll, records, now) {
    rctx.save();
    rctx.globalCompositeOperation = 'lighter';
    for (const { part, rec } of records) {
      const phase = (rec._heartPhase ?? 0) + now * 0.003;
      for (let i = 0; i < 3; i++) {
        const a = phase + i * 2.0944;
        const drift = Math.sin(now * 0.002 + i + (rec._heartPhase ?? 0)) * 6;
        const x = part.position.x + Math.cos(a) * 12 + drift;
        const y = part.position.y - 14 - (Math.sin(now * 0.001 + i) + 1) * 8;
        const alpha = 0.4 + Math.sin(now * 0.004 + i) * 0.25;
        rctx.fillStyle = `rgba(255, 110, 180, ${alpha})`;
        rctx.beginPath();
        rctx.arc(x, y, 2.5, 0, Math.PI * 2);
        rctx.fill();
      }
    }
    rctx.restore();
  },
};
