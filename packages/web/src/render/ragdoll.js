// Ragdoll renderer: limbs/body/head/expression + status overlays dispatched
// from the per-effect modules in src/effects/.
//
// Shape-agnostic, handles both v1 (all-circles) and v2 (head circle +
// rectangle torso/limbs/feet). Each part draws based on whether circleRadius
// exists (circle) or shape.kind === 'rect' (rectangle). Render order is band-
// based: lower limbs/feet first, upper limbs next, torso/pelvis above limbs,
// head last with expression overlay.

import { moodState } from '../mood.js';
import { hasStatus, renderStatusOverlays } from '../effects/registry.js';
import { pickExpression } from '../reactions/expressions.js';
import { partRadius } from '../abilities/_shared.js';
import { getCircleSprite, getRectSprite } from './gradient-cache.js';

const STATUS_IDS = ['concussed', 'on_fire', 'electrified', 'frozen', 'powered', 'in_blackhole'];

// Band order: feet/lower-segments first → upper segments → torso/pelvis →
// head. v1 has no foot/lower bands, so it collapses to limbs → torso → head
//, same as the old order.
function isLowerSegment(part) {
  // v2 lower segments are labeled with 'L' suffix (armLL, armLR, legLL, legLR).
  return part.label && (
    part.label === 'armLL' || part.label === 'armLR' ||
    part.label === 'legLL' || part.label === 'legLR'
  );
}

export function renderRagdoll(ctx, ragdoll, mood, status) {
  const ch = ragdoll.character;
  const state = moodState(mood);
  const now = performance.now();

  // 0–1. Under-body status passes (powered aura, blackhole hints).
  if (status) renderStatusOverlays(ctx, ragdoll, status, 'under', now);

  // 2a. Feet (v2 only), bottom-most layer.
  for (const part of ragdoll.parts) {
    if (part.partType === 'foot' && isFinitePart(part)) drawSegment(ctx, part, ch, status);
  }
  // 2b. Lower limbs (v2: lower-arm + lower-leg). For v1 this band is empty.
  for (const part of ragdoll.parts) {
    if ((part.partType === 'arm' || part.partType === 'leg') && isLowerSegment(part) && isFinitePart(part)) {
      drawSegment(ctx, part, ch, status);
    }
  }
  // 2c. Upper limbs (v1: all arm/leg balls; v2: upper-arm + upper-leg).
  for (const part of ragdoll.parts) {
    if ((part.partType === 'arm' || part.partType === 'leg') && !isLowerSegment(part) && isFinitePart(part)) {
      drawSegment(ctx, part, ch, status);
    }
  }
  // 2d. Torso parts. v1 = body circle; v2 = torso rect + pelvis rect.
  for (const part of ragdoll.parts) {
    if (part.partType === 'torso' && isFinitePart(part)) drawSegment(ctx, part, ch, status);
  }

  // 3. Head + expression
  if (isFinitePart(ragdoll.head)) drawHead(ctx, ragdoll.head, ch, state, mood, status, ragdoll);

  // 4–6. Over-body status passes (on_fire glow, electrified arcs, frozen glaze).
  if (status) renderStatusOverlays(ctx, ragdoll, status, 'over', now);

  // 7. Live-mode panic-move auras (e.g. Grok's unhinged red glow).
  if (ragdoll._unhingedUntil && now < ragdoll._unhingedUntil) {
    const t = (ragdoll._unhingedUntil - now) / 2400;
    ctx.save();
    ctx.globalAlpha = 0.35 * t;
    ctx.fillStyle = '#f87171';
    for (const p of ragdoll.parts) {
      if (!isFinitePart(p)) continue;
      const r = partRadius(p) * 1.4;
      ctx.beginPath();
      ctx.arc(p.position.x, p.position.y, r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }
}

export function isFinitePart(part) {
  return Number.isFinite(part?.position?.x)
      && Number.isFinite(part?.position?.y)
      && Number.isFinite(part?.angle);
}

function drawSegment(ctx, part, ch, status) {
  const { position, angle } = part;
  ctx.save();
  ctx.translate(position.x, position.y);

  // Tint sources: active on_fire (flickering) or recent scorch fade. Both
  // animate per frame, so they bypass the sprite cache and use the slow
  // inline gradient path.
  const onFire = !!(status && hasStatus(status, part, 'on_fire'));
  const scorched = !!(part._scorchedUntil && performance.now() < part._scorchedUntil);
  const tinted = onFire || scorched;

  let bodyCol = ch.body, darkCol = ch.bodyDark;
  if (tinted) {
    if (onFire) {
      const flick = 0.85 + Math.sin(performance.now() * 0.012) * 0.12;
      bodyCol = mix(bodyCol, '#ff8a3a', 0.55 * flick);
      darkCol = mix(darkCol, '#7a2a08', 0.6);
    } else {
      bodyCol = mix(bodyCol, '#3a2618', 0.35);
    }
  }

  if (part.circleRadius) {
    // v1 circle limb / circle body.
    const r = part.circleRadius;
    if (tinted) {
      const grad = ctx.createRadialGradient(0, -r * 0.35, 2, 0, 0, r);
      grad.addColorStop(0, bodyCol);
      grad.addColorStop(1, darkCol);
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(0, 0, r, 0, Math.PI * 2);
      ctx.fill();
    } else {
      const sprite = getCircleSprite(ch, part.partType, r);
      ctx.drawImage(sprite, -sprite.width / 2, -sprite.height / 2);
    }
  } else {
    // v2 rectangle. Rotate into body-local frame and draw a rounded rect.
    const shape = part.shape;
    const w = shape?.w ?? 32;
    const h = shape?.h ?? 32;
    const cornerR = shape?.radius ?? 4;
    ctx.rotate(angle);
    if (tinted) {
      const grad = ctx.createLinearGradient(0, -h / 2, 0, h / 2);
      grad.addColorStop(0, bodyCol);
      grad.addColorStop(1, darkCol);
      ctx.fillStyle = grad;
      ctx.beginPath();
      if (cornerR > 0 && ctx.roundRect) {
        ctx.roundRect(-w / 2, -h / 2, w, h, cornerR);
      } else {
        ctx.rect(-w / 2, -h / 2, w, h);
      }
      ctx.fill();
    } else {
      const sprite = getRectSprite(ch, part.partType, w, h, cornerR);
      ctx.drawImage(sprite, -sprite.width / 2, -sprite.height / 2);
    }
  }
  ctx.restore();
}

function drawHead(ctx, head, ch, state, mood, status, ragdoll) {
  const r = head.circleRadius || 28;
  const { position, angle } = head;
  ctx.save();
  ctx.translate(position.x, position.y);
  ctx.rotate(angle);

  const headOnFire = !!(status && hasStatus(status, head, 'on_fire'));
  if (headOnFire) {
    const flick = 0.85 + Math.sin(performance.now() * 0.012) * 0.12;
    const topCol = mix(lighten(ch.body, 0.18), '#ff8a3a', 0.5 * flick);
    const bottomCol = mix(ch.bodyDark, '#7a2a08', 0.55);
    const grad = ctx.createRadialGradient(0, -r * 0.3, 2, 0, 0, r);
    grad.addColorStop(0, topCol);
    grad.addColorStop(1, bottomCol);
    ctx.fillStyle = grad;
    ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.fill();
  } else {
    const sprite = getCircleSprite(ch, 'head', r);
    ctx.drawImage(sprite, -sprite.width / 2, -sprite.height / 2);
  }

  ctx.save();
  ctx.globalAlpha = 0.85;
  ch.drawLogo(ctx, r);
  ctx.restore();

  // Build active-status set for this head and let pickExpression decide
  // whether to override the mood-state face (x-eyes for concussed, panic
  // eyes + scream mouth on fire, etc).
  let headStatuses = null;
  if (status) {
    headStatuses = new Set();
    for (const id of STATUS_IDS) if (hasStatus(status, head, id)) headStatuses.add(id);
  }
  const override = pickExpression(headStatuses, mood);
  // KO forces closed eyes regardless of status override, knocked-out buddy
  // is unconscious, not on-fire-with-panic-eyes.
  const koActive = !!ragdoll?.koUntil && performance.now() < ragdoll.koUntil;
  const blinkClosed = koActive || (!!ragdoll?._blinkClosed && !override?.eyes);
  drawExpression(ctx, r, state.name, koActive ? null : override, blinkClosed);

  const flash = performance.now() - mood.lastShockAt;
  if (flash < 200) {
    ctx.globalAlpha = (1 - flash / 200) * 0.7;
    ctx.fillStyle = '#fff';
    ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.fill();
    ctx.globalAlpha = 1;
  }

  ctx.restore();
}

function drawExpression(ctx, r, state, override, blinkClosed) {
  ctx.save();
  // Status-driven jitter: shakes the whole face so on_fire/concussed faces
  // visually buzz. Cheap motion cue.
  if (override?.jitter) {
    const j = override.jitter;
    ctx.translate((Math.random() - 0.5) * j, (Math.random() - 0.5) * j);
  }
  ctx.fillStyle = 'rgba(0,0,0,0.85)';
  ctx.strokeStyle = 'rgba(0,0,0,0.85)';
  ctx.lineWidth = r * 0.07;
  ctx.lineCap = 'round';
  const ey = -r * 0.1, ex = r * 0.32, eR = r * 0.07;

  // EYES
  const eyeKey = override?.eyes;
  if (blinkClosed) {
    // Closed-eye blink, short horizontal arcs.
    ctx.beginPath();
    ctx.moveTo(-ex - eR * 1.2, ey); ctx.lineTo(-ex + eR * 1.2, ey);
    ctx.moveTo(ex - eR * 1.2, ey);  ctx.lineTo(ex + eR * 1.2, ey);
    ctx.stroke();
  } else if (eyeKey === 'x') {
    // Concussed, x-eyes, slightly bigger than the HURT cross.
    ctx.beginPath();
    const xr = eR * 1.4;
    ctx.moveTo(-ex - xr, ey - xr); ctx.lineTo(-ex + xr, ey + xr);
    ctx.moveTo(-ex + xr, ey - xr); ctx.lineTo(-ex - xr, ey + xr);
    ctx.moveTo(ex - xr, ey - xr);  ctx.lineTo(ex + xr, ey + xr);
    ctx.moveTo(ex + xr, ey - xr);  ctx.lineTo(ex - xr, ey + xr);
    ctx.stroke();
  } else if (eyeKey === 'panic') {
    // On fire, wide-open round eyes, bigger than baseline.
    ctx.beginPath();
    ctx.arc(-ex, ey, eR * 1.5, 0, Math.PI * 2);
    ctx.arc(ex, ey, eR * 1.5, 0, Math.PI * 2);
    ctx.fill();
    // White panic dot in center for that "AAAH" look.
    ctx.fillStyle = 'rgba(255,255,255,0.9)';
    ctx.beginPath();
    ctx.arc(-ex, ey, eR * 0.5, 0, Math.PI * 2);
    ctx.arc(ex, ey, eR * 0.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = 'rgba(0,0,0,0.85)';
  } else if (eyeKey === 'shock') {
    // Electrified, jagged squiggle-eyes.
    ctx.beginPath();
    for (const sx of [-ex, ex]) {
      ctx.moveTo(sx - eR * 1.1, ey);
      ctx.lineTo(sx - eR * 0.4, ey - eR * 0.5);
      ctx.lineTo(sx + eR * 0.2, ey + eR * 0.5);
      ctx.lineTo(sx + eR * 1.1, ey - eR * 0.3);
    }
    ctx.stroke();
  } else if (eyeKey === 'narrow') {
    // Frozen, narrow horizontal slits.
    ctx.beginPath();
    ctx.moveTo(-ex - eR, ey); ctx.lineTo(-ex + eR, ey);
    ctx.moveTo(ex - eR, ey);  ctx.lineTo(ex + eR, ey);
    ctx.stroke();
  } else if (eyeKey === 'wince') {
    // Pain-flinch, squeezed-shut eyes arc downward like ">_<". Reads as
    // an instantaneous reaction even when mood-state is HAPPY.
    ctx.beginPath();
    ctx.moveTo(-ex - eR * 1.3, ey - eR * 0.7);
    ctx.quadraticCurveTo(-ex, ey + eR * 0.5, -ex + eR * 1.3, ey - eR * 0.7);
    ctx.moveTo(ex - eR * 1.3, ey - eR * 0.7);
    ctx.quadraticCurveTo(ex, ey + eR * 0.5, ex + eR * 1.3, ey - eR * 0.7);
    ctx.stroke();
  } else if (state === 'BROKEN' || state === 'HURT') {
    ctx.beginPath();
    ctx.moveTo(-ex - eR, ey - eR); ctx.lineTo(-ex + eR, ey + eR);
    ctx.moveTo(-ex + eR, ey - eR); ctx.lineTo(-ex - eR, ey + eR);
    ctx.moveTo(ex - eR, ey - eR);  ctx.lineTo(ex + eR, ey + eR);
    ctx.moveTo(ex + eR, ey - eR);  ctx.lineTo(ex - eR, ey + eR);
    ctx.stroke();
  } else if (state === 'WORRIED') {
    ctx.beginPath();
    ctx.arc(-ex, ey, eR * 0.7, 0, Math.PI * 2);
    ctx.arc(ex, ey, eR * 0.7, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(-ex - eR * 1.3, ey - eR * 1.6); ctx.lineTo(-ex + eR * 0.6, ey - eR * 0.8);
    ctx.moveTo(ex + eR * 1.3,  ey - eR * 1.6); ctx.lineTo(ex - eR * 0.6,  ey - eR * 0.8);
    ctx.stroke();
  } else if (state === 'ECSTATIC') {
    ctx.beginPath();
    ctx.moveTo(-ex - eR * 1.2, ey + eR * 0.2); ctx.lineTo(-ex, ey - eR);
    ctx.lineTo(-ex + eR * 1.2, ey + eR * 0.2);
    ctx.moveTo(ex - eR * 1.2, ey + eR * 0.2);  ctx.lineTo(ex, ey - eR);
    ctx.lineTo(ex + eR * 1.2, ey + eR * 0.2);
    ctx.stroke();
  } else {
    ctx.beginPath();
    ctx.arc(-ex, ey, eR, 0, Math.PI * 2);
    ctx.arc(ex, ey, eR, 0, Math.PI * 2);
    ctx.fill();
  }

  // MOUTH
  ctx.beginPath();
  const my = r * 0.36;
  const mouthKey = override?.mouth;
  if (mouthKey === 'scream') {
    // On fire, wide-open round screaming mouth.
    ctx.fillStyle = 'rgba(0,0,0,0.85)';
    ctx.ellipse(0, my, r * 0.18, r * 0.22, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
  } else if (mouthKey === 'wobble') {
    // Concussed, drunk wobble line.
    const t = performance.now() * 0.01;
    ctx.moveTo(-r * 0.22, my);
    for (let k = 1; k <= 6; k++) {
      const px = -r * 0.22 + (r * 0.44) * (k / 6);
      const py = my + Math.sin(t + k) * r * 0.04;
      ctx.lineTo(px, py);
    }
  } else if (mouthKey === 'shock') {
    // Electrified, small jagged mouth.
    ctx.moveTo(-r * 0.16, my);
    ctx.lineTo(-r * 0.05, my - r * 0.06);
    ctx.lineTo(r * 0.05, my + r * 0.06);
    ctx.lineTo(r * 0.16, my);
  } else if (mouthKey === 'flat') {
    // Frozen, flat tight line.
    ctx.moveTo(-r * 0.12, my); ctx.lineTo(r * 0.12, my);
  } else if (mouthKey === 'grimace') {
    // Pain-flinch, clenched downturned mouth. Paired with wince eyes.
    ctx.moveTo(-r * 0.22, my - r * 0.02);
    ctx.quadraticCurveTo(0, my + r * 0.10, r * 0.22, my - r * 0.02);
  } else if (state === 'ECSTATIC' || state === 'HAPPY') {
    ctx.arc(0, my - r * 0.05, r * 0.28, 0, Math.PI);
  } else if (state === 'CONTENT') {
    ctx.moveTo(-r * 0.18, my); ctx.lineTo(r * 0.18, my);
  } else if (state === 'WORRIED') {
    ctx.moveTo(-r * 0.2, my + r * 0.04); ctx.quadraticCurveTo(0, my - r * 0.05, r * 0.2, my + r * 0.04);
  } else if (state === 'HURT') {
    ctx.arc(0, my + r * 0.06, r * 0.16, Math.PI, 0);
  } else if (state === 'BROKEN') {
    ctx.arc(0, my + r * 0.04, r * 0.18, Math.PI, 0);
  }
  ctx.stroke();
  ctx.restore();
}

function lighten(hex, amt) {
  const c = hex.replace('#', '');
  const num = parseInt(c, 16);
  const r = Math.min(255, ((num >> 16) & 0xff) + Math.round(255 * amt));
  const g = Math.min(255, ((num >> 8) & 0xff) + Math.round(255 * amt));
  const b = Math.min(255, (num & 0xff) + Math.round(255 * amt));
  return `rgb(${r},${g},${b})`;
}

function mix(a, b, t) {
  const ca = parseColor(a), cb = parseColor(b);
  const r  = Math.round(ca[0] + (cb[0] - ca[0]) * t);
  const g  = Math.round(ca[1] + (cb[1] - ca[1]) * t);
  const bl = Math.round(ca[2] + (cb[2] - ca[2]) * t);
  return `rgb(${r},${g},${bl})`;
}

function parseColor(s) {
  if (s.startsWith('#')) {
    const c = s.slice(1);
    const n = parseInt(c.length === 3 ? c.split('').map(x => x + x).join('') : c, 16);
    return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
  }
  const m = s.match(/(\d+)/g);
  return m ? [Number(m[0]), Number(m[1]), Number(m[2])] : [255, 255, 255];
}
