// ClankyBuddy boot orchestrator + main loop. Engine setup, ragdoll lifecycle,
// hit-stop, mouse handling and ability ctx all live in src/state and src/input.
// This file's job is the fixed-timestep loop, the per-frame render dispatch,
// the collision dispatch one-liner, and the boot wiring.

import Matter from 'matter-js';
import { applyStandPose, tickLimp } from './physics/stand.js';
import { decayMood, maybeSpeak } from './mood.js';
import { tickBehavior } from './behavior/scheduler.js';
import { configureSpeechBubbles, popBubble } from './ui/speech-bubbles.js';
import * as P from './particles.js';
import {
  clearStage, renderRagdoll, renderTransients, renderToolCursor,
  renderFloor, renderContactShadow,
} from './render/index.js';
import { hasStatus, tickStatuses } from './effects/registry.js';
import { processCollision, cleanupTransients } from './transients/index.js';

// State singletons
import { canvas, ctx, engine, world, mouseConstraint, resize } from './state/world.js';
import { FIXED_DT, MAX_SUBSTEPS, MAX_FRAME_DT_MS, GRAB_DRAG_MASK } from './physics/constants.js';
import { tickHitStop } from './state/time.js';
import { abilityCtx, flushPendingHitCombo } from './state/ability-ctx.js';
import {
  transientBodies, getRagdoll, getCurrentBuddy, spawnRagdoll, resetMood,
} from './state/ragdoll-lifecycle.js';

// UI / input
import { buildCharacterPicker, getActiveChar, onCharChange } from './ui/character-picker.js';
import { bindHotbar, getActiveTool, setActiveTool } from './ui/hotbar.js';
import { updateMoodUI } from './ui/mood-meter.js';
import { bindCurrencyHud } from './ui/currency-hud.js';
import { bindLog, attachChatClient } from './ui/log.js';
import { startChat, enqueuePendingMessage } from './net/chat-bootstrap.js';
import { startChatSeed } from './net/chat-seed.js';
import { bindBossNameplate, showBossNameplate } from './ui/boss-nameplate.js';
import { openPicker } from './ui/slot-picker.js';
import { bindDevPanel } from './ui/dev-panel.js';
import { bindSettings } from './ui/settings-popover.js';
import { bindStatsPopover } from './ui/stats-popover.js';
import { bindTargetPicker } from './ui/target-picker.js';
import { bindExtWelcome } from './ui/ext-welcome.js';
import { bindKeyboard } from './input/keyboard.js';
import { bindMouse, getMouseState } from './input/mouse.js';
import { ensureAgeGate } from './ui/age-gate.js';

import { tickEarn } from './progression/earn.js';
import { bootstrap as bootstrapUpgrades } from './progression/apply-upgrades.js';
import { getEquippedBar, setActiveCharForProgression } from './progression/state.js';
import { startSession, endSession, emit, flush as flushTelemetry, setSink, setUserId } from './telemetry/events.js';
import { createFetchSink, bindUserIdSetter } from './net/events-sink.js';
import { moodState } from './mood.js';
import { resetLive } from './live/index.js';
import { tickModes, onCharChange as modesOnCharChange } from './modes/bus.js';
// Side-effect import: registers the live / panic-moves / gameplay-shape /
// plumbing adapter Modes on the bus. Must run before the first loop tick.
import './modes/register-defaults.js';
// Side-effect import: registers the 4 Mode events (Antitrust, Board Drama,
// Sora Wave, Compliance Theater), Phase 7 of the 2026-05-02 ability
// redesign (see docs/abilities.md §6).
import './modes/events.js';
import { renderDebugOverlay } from './render/debug-overlay.js';
import { getSetting, onSettingsChange } from './state/settings.js';

const { Engine, Events } = Matter;

configureSpeechBubbles({
  moodState: () => getCurrentBuddy().mood,
  status: () => getCurrentBuddy().status,
  ragdoll: getRagdoll,
  classify: moodState,
  hasStatus,
});

// ---------- collision dispatch ----------
// Per-type contact handling lives in src/transients/*.js. Generic body.onHit
// closures (rocket/fireball/anvil) are still honored via processCollision.
Events.on(engine, 'collisionStart', (ev) => {
  const c = abilityCtx();
  for (const pair of ev.pairs) {
    processCollision(pair.bodyA, pair.bodyB, c);
    processCollision(pair.bodyB, pair.bodyA, c);
  }
});

// ---------- main loop ----------
let lastT = performance.now();
let accumulator = 0;
// Idle speech cadence, keeps the buddy chatty between hits. Jittered so
// it doesn't feel metronomic.
let nextIdleSpeechAt = performance.now() + 4000 + Math.random() * 4000;
function scheduleNextIdleSpeech(now) {
  nextIdleSpeechAt = now + 6000 + Math.random() * 8000;
}
function loop() {
  const now = performance.now();
  let frameDt = now - lastT;
  if (frameDt > MAX_FRAME_DT_MS) frameDt = MAX_FRAME_DT_MS; // skip huge gaps (tab focus etc.)
  lastT = now;

  // Loop-drive hit-stop expiry. We can't rely on setTimeout: backgrounded
  // tabs throttle it to ≥1s and the unfreeze fires hours late, which makes
  // every subsequent hitStop() early-return because `remaining` is stale.
  tickHitStop(now);

  // Per-buddy state lives on the Buddy struct now. Single dereference at
  // the top of the frame keeps the rest of the loop terse; in Swarm mode
  // this will become a loop over buddies.
  const buddy = getCurrentBuddy();
  const { mood, status } = buddy;
  const ragdoll = getRagdoll();

  // unfreeze when timer expires (frozen.js writes frozenUntil for render compat)
  if (ragdoll) {
    for (const p of ragdoll.parts) if (p.frozenUntil && now > p.frozenUntil) p.frozenUntil = 0;
  }

  // Toggle mouse-constraint grab based on active tool. Set every frame
  // because the user can switch tools at any moment. GRAB_DRAG_MASK is
  // 0xFFFFFFFF with the HUD bit cleared, so dragging a ragdoll ball
  // through the hotbar/chat-cluster region doesn't pull it into static
  // HUD geometry (the soft mouse spring + stiff ragdoll joints would
  // destabilize against infinite-mass static bodies).
  const tool = getActiveTool();
  mouseConstraint.collisionFilter.mask = (tool === 'grab') ? GRAB_DRAG_MASK : 0;

  // fixed-timestep physics for stability with constraints.
  accumulator += frameDt;
  let steps = 0;
  while (accumulator >= FIXED_DT && steps < MAX_SUBSTEPS) {
    if (ragdoll) {
      tickLimp(ragdoll);
      tickBehavior(abilityCtx(), FIXED_DT);
      applyStandPose(ragdoll, engine.gravity.y);
    }
    if (ragdoll) tickStatuses(status, ragdoll, abilityCtx(), FIXED_DT);
    // Mode bus replaces direct optional ticker calls (live, panic-moves,
    // plumbing). Live mode gating still flows through the 'liveMode' setting
    // → register-defaults.js syncs it onto the bus.
    // Plumbing runs at the 'frame' phase (after the inner loop).
    tickModes(abilityCtx(), FIXED_DT, 'physics');
    Engine.update(engine, FIXED_DT);
    accumulator -= FIXED_DT;
    steps++;
  }
  // Clamp accumulator after sub-step cap. Without this, sustained slow
  // frames queue more steps than the cap can consume each frame and the
  // queue grows monotonically, time-debt that the game never burns off.
  if (accumulator > FIXED_DT * MAX_SUBSTEPS) {
    accumulator = FIXED_DT * MAX_SUBSTEPS;
  }
  P.update(frameDt);
  decayMood(mood, frameDt);
  tickEarn(mood, getActiveChar());
  cleanupTransients(world, transientBodies, abilityCtx);

  // Frame-phase modes (e.g. plumbing), runs once per render frame, not
  // per physics step. Cosmetic-only systems live here.
  tickModes(abilityCtx(), 0, 'frame');

  // KO state: a heavy hit that pushed happiness to BROKEN knocks the buddy
  // out. Stays ragdolled (long stun) until lightning revives. Canonical IB-1
  // mechanic, the original required the stun-gun to wake a downed buddy.
  if (ragdoll && !ragdoll.koUntil && moodState(mood).name === 'BROKEN' && now - mood.lastShockAt < 500) {
    ragdoll.koUntil = now + 8000;
    ragdoll.stunUntil = Math.max(ragdoll.stunUntil || 0, now + 8000);
  }
  if (ragdoll && ragdoll.koUntil && now > ragdoll.koUntil) {
    ragdoll.koUntil = 0;
  }

  // Out-of-bounds safety net. v2's segmented bodies are smaller targets than
  // v1's circles and can tunnel past the walls under high-velocity drag.
  // Check ANY part, limbs frequently leave frame while chest stays in
  // bounds. Don't respawn during active drag (would yank from the user's
  // grip mid-motion); the wall thickness handles the drag case, and this
  // catches whatever still slips through.
  if (ragdoll && !ragdoll.dragging) {
    const cw = canvas.width, ch = canvas.height;
    for (const part of ragdoll.parts) {
      const px = part.position.x, py = part.position.y;
      if (px < -80 || px > cw + 80 || py < -80 || py > ch + 80) {
        spawnRagdoll(getActiveChar());
        break;
      }
    }
  }

  // Passive idle speech, buddy comments on its mood every ~6-14s. Skip when
  // KO'd (a knocked-out buddy doesn't chat).
  if (ragdoll && !ragdoll.koUntil && now >= nextIdleSpeechAt) {
    const text = maybeSpeak(mood, 0);
    if (text) popBubble(ragdoll.head, text);
    scheduleNextIdleSpeech(now);
  }

  // render
  clearStage(ctx, canvas.width, canvas.height);
  renderFloor(ctx, canvas.width, canvas.height);
  if (ragdoll) renderContactShadow(ctx, ragdoll, canvas.width, canvas.height);
  if (ragdoll) renderRagdoll(ctx, ragdoll, mood, status);
  renderTransients(ctx, transientBodies);
  P.render(ctx);
  const ms = getMouseState();
  if (ragdoll && ms.mouseHover) {
    renderToolCursor(ctx, tool, ms.lastX, ms.lastY, ragdoll, ms.isDown, ms.dragStart, engine.gravity.y);
  }
  updateMoodUI(mood);
  if (getSetting('debugOverlay')) renderDebugOverlay(ctx, ragdoll, status, transientBodies);

  requestAnimationFrame(loop);
}

// ---------- theme ----------
// Apply on boot and re-apply when settings change. Body classes drive the
// light/dark token swap in tokens.css.
function applyTheme(theme) {
  document.body.classList.toggle('theme-light', theme === 'light');
  document.body.classList.toggle('theme-dark',  theme !== 'light');
}
applyTheme(getSetting('theme'));
onSettingsChange((key, val) => {
  if (key === 'theme') applyTheme(val);
});

// ---------- viewport guard ----------
const MIN_VIEWPORT_WIDTH = 900;
function updateViewportGuard() {
  const el = document.querySelector('.vg-size');
  if (!el) return;
  const width = Math.round(window.innerWidth);
  const shortBy = Math.max(0, MIN_VIEWPORT_WIDTH - width);
  el.textContent = shortBy > 0
    ? `current width: ${width}px · ${shortBy}px more needed`
    : `current width: ${width}px`;
}
updateViewportGuard();
window.addEventListener('resize', updateViewportGuard);

// ---------- boot ----------
// Resolve action-bar mount points once. UI modules are location-agnostic,
// they take an element so the same modules can be re-mounted into a different
// scene/layout (e.g. a future mobile build) without code changes.
//
// EVERYTHING below, pointer/keyboard binding, character picker build, RAF
// loop start, telemetry session, sits behind the first-run age-gate.
// ensureAgeGate() resolves only after the user attests 13+; if they decline
// it never resolves and the boot stalls deliberately so the canvas / WS /
// physics loop never light up. The age-gate is independent of save state and
// survives __clankyReset(); see src/ui/age-gate.js for storage details.
void (async () => {
  await ensureAgeGate();

const $ = (id) => document.getElementById(id);
buildCharacterPicker($('character-picker'));
bindHotbar($('hotbar'));
bindKeyboard();
bindCurrencyHud($('currency-amount'));
bindLog($('log-window'));
// Client-only seed: the AI personas chatter in-character so an empty room
// reads as alive. Cadence tapers when real chatter shows up; nothing here
// touches the network.
startChatSeed();
// Lazy chat bootstrap: defer /auth/init until the user actually focuses
// the input or types a message. Players who never look at chat shouldn't
// generate anonymous accounts.
//
// First-message UX: the boot shim buffers typed text into chat-bootstrap's
// pending queue and clears the input immediately. chat-bootstrap drains
// the queue into the real WebSocket on the first 'connected' status
// transition. On terminal failure (auth/captcha/protocol-outdated) the
// queue is drained into chat-event log lines so the user sees what was
// dropped instead of the text vanishing.
{
  attachChatClient({
    onSend: (text) => {
      enqueuePendingMessage(text);
      return true;
    },
  });
  const logEl = $('log-window');
  if (logEl) {
    logEl.addEventListener('focusin', (e) => {
      if (e.target.classList?.contains('log-input')) void startChat();
    });
  }
}
bindBossNameplate();
{ const _u = $('upgrades-btn'); if (_u) _u.addEventListener('click', () => openPicker()); }
// Grab system-slot button (left of hotbar). Same semantics as the Space
// hotkey: setActiveTool('grab'). data-tool="grab" lives on the element in
// index.html so the initial active highlight (which runs during bindHotbar,
// before this wire) picks it up alongside the hotbar slots.
{ const _g = $('grab-btn'); if (_g) _g.addEventListener('click', () => setActiveTool('grab')); }
bindDevPanel();
bindSettings($('settings-btn'));
bindStatsPopover($('stats-btn'));
bindTargetPicker();
bindMouse();
// First-launch welcome card, VS Code extension only. No-op on the web.
bindExtWelcome();
// Apply any saved upgrade nodes to ability stats. Subscribes to state.onChange
// so subsequent purchases re-mutate the live stats without a reload.
bootstrapUpgrades();
// Boss nameplate is the canonical identity surface, top-center banner
// with name + provider + persistent mood bar. Fires on every character
// change (replays the swap-flash) and once at boot (plays the full intro).
// onCharChange fires AFTER setActiveChar has already mutated active id, so
// getActiveChar() returns the new id by the time we're invoked. Track the
// previous id ourselves so character_switch carries an honest from.
let _prevCharForTelemetry = getActiveChar();
onCharChange((id) => {
  if (_prevCharForTelemetry && _prevCharForTelemetry !== id) {
    emit({ type: 'character_switch', from: _prevCharForTelemetry, to: id });
  }
  _prevCharForTelemetry = id;
  // Swap the per-character progression slice FIRST, the apply-upgrades
  // bootstrap subscribes to this and rebuilds STATS for the new character
  // before the ragdoll spawns and the mode bus fans out.
  setActiveCharForProgression(id);
  resetMood();
  resetLive();
  spawnRagdoll(id);
  showBossNameplate(id);
  // Fan out to enabled Modes (live's onCharChange resets its panic meter,
  // future Modes can add their own char-switch hooks).
  modesOnCharChange(abilityCtx());
});
resize();
spawnRagdoll(getActiveChar());
showBossNameplate(getActiveChar());

// Telemetry: wire the fetch sink before opening the session so the
// session_start event hits the worker. Sink reads auth lazily, pre-auth
// flushes fall back to console.debug, post-auth flushes ship to
// /events/batch. bindUserIdSetter pushes user_id into the envelope as
// soon as auth lands (chat bootstrap or a previously persisted token).
bindUserIdSetter(setUserId);
setSink(createFetchSink({
  debugFallback: (batch) => console.debug('[telemetry] (no-auth)', batch.events.length, batch),
}));

// Telemetry: open the session once the boot ragdoll exists. equipped_tools
// is the first hotbar's non-null slots; bar_idx defaults to 0 (the active
// bar at boot, multi-bar switching isn't a session boundary).
{
  const slots = getEquippedBar(0) || [];
  startSession({
    character: getActiveChar(),
    barIdx: 0,
    equippedTools: slots.filter(Boolean),
    reducedMotion: !!getSetting('reduceMotion'),
  });
}

// Close the session on tab close / navigation. pagehide is the modern
// unload signal; the telemetry module also flushes on visibilitychange,
// but session_end specifically should fire here so duration_ms is honest.
window.addEventListener('pagehide', () => {
  flushPendingHitCombo();
  const m = getCurrentBuddy().mood;
  endSession('unload', {
    finalMood: m.happiness,
    finalState: moodState(m).name,
  });
  flushTelemetry();
});

requestAnimationFrame(loop);
})();
