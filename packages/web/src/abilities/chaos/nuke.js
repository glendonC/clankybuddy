import Matter from 'matter-js';
import * as P from '../../particles.js';
import { sfx } from '../../audio/sfx.js';
import { spikeFear } from '../../mood.js';
import { stun, goLimp } from '../../physics/stand.js';
import { applyStatus, clearAll as clearAllStatus } from '../../effects/registry.js';
import { showNuke, showCombo } from '../../ui/overlays.js';
import { startCooldown } from '../../ui/hotbar.js';
import { getStats } from '../_stats.js';
import { forEachBuddy } from '../../state/ragdoll-lifecycle.js';
import { abilityCtxFor } from '../../state/ability-ctx.js';

const { Body, Composite } = Matter;

export const defaultStats = {
  mood:           100,    // mood drop on detonation (positive; subtracted)
  falloutPoolMs:  0,      // duration of post-detonation fire pools (0 = none).
                          // Cataclysm Fallout upgrade lifts this to 6000ms.
};

export default {
  id: 'nuke',
  defaultStats,
  apply(ctx) {
    const s = getStats('nuke');
    startCooldown('nuke');
    sfx.nukeSiren();
    // Big telegraphed threat, siren plays for 1.5s, give the buddy a max-fear
    // spike so it cowers through the entire wind-up.
    spikeFear(ctx.mood, 100);
    const epoch = ctx._epoch;
    setTimeout(() => {
      if (!ctx._epochValid?.(epoch)) return;
      const { ragdoll, world, screenShake, transientBodies } = ctx;

      showNuke();
      sfx.nuke();
      screenShake(30, 1600);
      ctx.hitStop?.mega();

      // Blast centered on the player centroid (the cast reference).
      let cx = 0, cy = 0;
      for (const p of ragdoll.parts) { cx += p.position.x; cy += p.position.y; }
      cx /= ragdoll.parts.length; cy /= ragdoll.parts.length;

      // Phase-6 friendly-fire: the nuke flings + ignites EVERY buddy in the
      // scene, each taking damage to its own mood/status. Single buddy = the old
      // behavior (clear status, fling, ignite, mood, stun/limp the one buddy).
      const moodDelta = -s.mood;
      forEachBuddy(bd => {
        if (!bd.ragdoll || !bd.ragdoll.parts || !bd.ragdoll.parts.length) return;
        const bctx = bd.id === ctx.buddyId ? ctx : abilityCtxFor(bd);
        clearAllStatus(bd.status);
        const hitParts = [];
        for (const p of bd.ragdoll.parts) {
          const dx = p.position.x - cx, dy = p.position.y - cy;
          const d = Math.hypot(dx, dy) || 1;
          // Big radial fling, additive on whatever they're already doing.
          Body.setVelocity(p, {
            x: p.velocity.x + (dx / d) * 28 + (Math.random() - 0.5) * 4,
            y: p.velocity.y + (dy / d) * 28 - 8,
          });
          Body.setAngularVelocity(p, p.angularVelocity + (Math.random() - 0.5) * 0.6);
          applyStatus(bd.status, p, 'on_fire', { source: 'nuke' });
          hitParts.push(p);
        }
        const perPartDelta = hitParts.length ? moodDelta / hitParts.length : moodDelta;
        for (const p of hitParts) {
          bctx.reactTo?.({
            source: 'nuke',
            part: p,
            moodDelta: perPartDelta,
            impulse: 28,
            // Only the head speaks; other limbs silent.
            speakMs: p === bd.ragdoll.head ? 800 : 99999,
          });
        }
        if (!hitParts.length && bd.id === ctx.buddyId) bctx.reactTo?.({ source: 'nuke', moodDelta, speakMs: 99999 });
        stun(bd.ragdoll, 2500);
        goLimp(bd.ragdoll, 1800);
      });

      P.burst(cx, cy, 60, { type: 'fire',  color: '#ff6b1a', size: 22, life: 1200, speedRange: 2.4, gravity: -0.0008 });
      P.burst(cx, cy, 40, { type: 'smoke', color: '#222',    size: 30, life: 1800, speedRange: 1.2, gravity: -0.0006 });
      P.burst(cx, cy, 50, { type: 'spark', color: '#fff',    size: 4,  life: 600,  speedRange: 2.0 });

      // Honor pending onExpire on every transient before wiping. Skipping
      // non-grenades was an audit miss: fire pools, mode-collapse zones,
      // meathooks and other transients carry cleanup state in onExpire
      // (status removal, anchor release, etc) and leak silently if the
      // nuke yanks them out of the world without firing.
      // Grenades the player committed to still detonate (they paid the
      // cost). For everything else, onExpire is the right cleanup hook.
      for (let i = transientBodies.length - 1; i >= 0; i--) {
        const b = transientBodies[i];
        if (b.onExpire && !b._spent) {
          b._spent = true;
          try { b.onExpire(b, ctx); }
          catch (err) { console.warn('[nuke] onExpire threw for', b.partType, err); }
        }
        Composite.remove(world, b);
        transientBodies.splice(i, 1);
      }
      // Fallout: spawn lingering fire pools across the stage. Spawned AFTER
      // the transientBodies wipe so they survive (the wipe was meant for
      // pre-nuke projectiles, not post-detonation hazards).
      if (s.falloutPoolMs > 0) {
        for (let i = -1; i <= 1; i++) {
          ctx._spawnFirePool?.(cx + i * 220, cy, s.falloutPoolMs);
        }
      }
      showCombo?.('NUKE', '#ff6b1a');
    }, 1500);
  },
  drawCursor(ctx, { x, y }) {
    ctx.save();
    ctx.translate(x, y);
    ctx.fillStyle = '#1c1c20';
    ctx.fillRect(-10, -4, 20, 10);
    ctx.fillStyle = '#ef4444';
    ctx.beginPath(); ctx.arc(0, -4, 6, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 7px Inter, sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('!', 0, -4);
    ctx.restore();
  },
};
