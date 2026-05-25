// Force Quit (kill -9), Cataclysm group. Click ability, cd:60. Finisher:
// only fires when buddy mood is HURT or BROKEN; refuses (no cooldown burn)
// otherwise. This makes it categorically distinct from nuke, nuke starts
// the chaos, force_quit ends them when they're already breaking. Sends the
// buddy into a 1.5s intangible "force-quit-active" window during which
// damage is voided and they're rendered at 12% alpha. On expiry: massive
// mood drop (wipes to BROKEN), popBubble "kernel panic", screen flash.
// Avoids the KO/lightning-revive race the audit flagged, no ragdoll
// despawn, just a status-driven outage. Phase 7 visceral-redirect.

import { moodState } from '../../mood.js';
// big mood drop routed through ctx.reactTo.
import { applyStatus } from '../../effects/registry.js';
import { sfx } from '../../audio/sfx.js';
import { showFlash } from '../../ui/overlays.js';
import { startCooldown } from '../../ui/hotbar.js';
import { goLimp, stun } from '../../physics/stand.js';

export default {
  id: 'force_quit',
  apply(ctx) {
    const { ragdoll, mood, status, popBubble, screenShake } = ctx;
    if (!ragdoll?.head) return;
    // Finisher gate: only valid against a buddy already at HURT or BROKEN.
    // Refusal does NOT burn the cooldown, the player can keep hammering
    // the button while damaging until the kill is online. Distinguishes
    // force_quit from nuke (nuke = open with chaos, force_quit = finish).
    const state = moodState(mood).name;
    if (state !== 'HURT' && state !== 'BROKEN') {
      popBubble?.(ragdoll.head, 'still standing');
      sfx.gun?.();           // dry click, nothing happens
      return;
    }
    // Apply the intangibility status, damageMul will read this and return 0
    // for the duration so anything in flight just whiffs.
    applyStatus(status, ragdoll.head, 'force_quit_active', {
      duration: 1500,
      source: 'force_quit',
    });
    popBubble?.(ragdoll.head, 'kernel panic');
    sfx.bomb?.();
    showFlash?.('#ff3838', 220, 0.6);
    screenShake?.(18, 220);
    goLimp(ragdoll, 1500);
    stun(ragdoll, 1500);
    startCooldown('force_quit');

    // Schedule the punishment for after the intangibility ends. Epoch-guard
    // so a character swap mid-window doesn't punish the new buddy.
    const epoch = ctx._epoch;
    setTimeout(() => {
      if (!ctx._epochValid?.(epoch)) return;
      // Wipe to BROKEN, drop happiness to the floor with a single delta.
      // applyMoodDelta clamps to the legal range; we overshoot so any
      // intermediate moodMul (Sycophant 2×, etc.) can't keep the buddy alive.
      // Suppress pool speech; "<process killed>" below is the canonical line.
      ctx.reactTo?.({ source: 'force_quit', part: ragdoll.head, moodDelta: -300, speakMs: 99999 });
      sfx.shatter?.();
      showFlash?.('#ffffff', 160, 0.9);
      popBubble?.(ragdoll.head, '<process killed>');
    }, 1500);
  },
  drawCursor(rctx, { x, y }) {
    rctx.save();
    rctx.translate(x, y);
    // Terminal-style red X-in-square.
    rctx.strokeStyle = '#ff3838';
    rctx.fillStyle   = 'rgba(255, 56, 56, 0.15)';
    rctx.lineWidth = 1.6;
    rctx.beginPath(); rctx.rect(-9, -9, 18, 18); rctx.fill(); rctx.stroke();
    rctx.beginPath();
    rctx.moveTo(-5, -5); rctx.lineTo(5, 5);
    rctx.moveTo( 5, -5); rctx.lineTo(-5, 5);
    rctx.stroke();
    rctx.restore();
  },
};
