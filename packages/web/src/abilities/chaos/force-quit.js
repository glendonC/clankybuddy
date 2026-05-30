// Coup de grâce, Cataclysm group. Click ability, cd:60. Finisher: only fires
// when buddy mood is HURT or BROKEN; refuses (no cooldown burn) otherwise.
// This makes it categorically distinct from nuke, nuke starts the chaos, the
// coup ends them when they're already breaking. Sends the buddy into a 1.5s
// "finishing" window during which damage is voided and they're rendered at
// ~12% alpha. On expiry: massive mood drop (wipes to BROKEN), screen flash.
// Avoids the KO/lightning-revive race the audit flagged, no ragdoll despawn,
// just a status-driven outage.
//
// Tool id stays 'force_quit' (legacy internal id, baked into the save / node
// ids); only the player-facing flavor changed.

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
    // Apply the finishing status, damageMul reads this and returns 0 for the
    // duration so anything in flight just whiffs.
    applyStatus(status, ragdoll.head, 'finishing', {
      duration: 1500,
      source: 'force_quit',
    });
    popBubble?.(ragdoll.head, 'no— wait');
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
      // intermediate moodMul can't keep the buddy alive. Suppress pool
      // speech; "lights out" below is the canonical line.
      ctx.reactTo?.({ source: 'force_quit', part: ragdoll.head, moodDelta: -300, speakMs: 99999 });
      sfx.shatter?.();
      showFlash?.('#ffffff', 160, 0.9);
      popBubble?.(ragdoll.head, 'lights out');
    }, 1500);
  },
  drawCursor(rctx, { x, y }) {
    rctx.save();
    rctx.translate(x, y);
    // Downward finisher dagger over a faint target ring.
    rctx.strokeStyle = 'rgba(255, 56, 56, 0.5)';
    rctx.lineWidth = 1.4;
    rctx.beginPath(); rctx.arc(0, 0, 10, 0, Math.PI * 2); rctx.stroke();
    // Blade pointing down at the cursor.
    rctx.fillStyle = '#d7dde3';
    rctx.beginPath();
    rctx.moveTo(0, 9);            // point
    rctx.lineTo(-2.5, -4);
    rctx.lineTo(2.5, -4);
    rctx.closePath();
    rctx.fill();
    // Crossguard + pommel.
    rctx.fillStyle = '#888';
    rctx.fillRect(-5, -6, 10, 2);
    rctx.fillStyle = '#3a2b1c';
    rctx.fillRect(-1.5, -10, 3, 4);
    rctx.restore();
  },
};
