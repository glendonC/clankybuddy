// Offscreen-canvas sprite cache for ragdoll body parts.
//
// Pre-renders the per-(character, partType, dimensions) gradient fill into a
// reusable offscreen canvas so the per-frame render path can stamp it via
// drawImage instead of rebuilding createRadialGradient / createLinearGradient
// every frame.
//
// Tinted frames (on_fire active OR _scorchedUntil) bypass this module, their
// colors animate per frame, so caching is a net loss. See render/ragdoll.js
// for the dispatch.
//
// The cache is keyed on dimensions so v2 rect parts of different sizes get
// distinct sprites. It never invalidates, sprites are valid for the page
// session, bounded by character roster × part-type set (~24 entries).

const SPRITE_PAD = 2;

const _cache = new Map();
export const __cacheStats = { hits: 0, misses: 0, entries: 0 };

/**
 * Get (or build) a circle sprite for head / v1-circle parts. The sprite's
 * center sits at (size/2, size/2); callers stamp via
 * `ctx.drawImage(sprite, -sprite.width/2, -sprite.height/2)`.
 *
 * `partType === 'head'` triggers the head-specific gradient: top color
 * lightened by 0.18 and a slightly higher highlight origin (-r*0.30 vs
 * -r*0.35), matching drawHead in render/ragdoll.js.
 */
export function getCircleSprite(character, partType, r) {
  const rk = Math.round(r);
  const key = `${character.id}:${partType}:c:${rk}`;
  const hit = _cache.get(key);
  if (hit) {
    __cacheStats.hits++;
    return hit;
  }
  __cacheStats.misses++;
  const sprite = buildCircleSprite(character, partType, rk);
  _cache.set(key, sprite);
  __cacheStats.entries = _cache.size;
  return sprite;
}

/**
 * Get (or build) a rect sprite for v2 torso/limbs/feet. The sprite's center
 * sits at (size/2, size/2). Caller is responsible for translating + rotating
 * before drawImage.
 */
export function getRectSprite(character, partType, w, h, cornerR) {
  const wk = Math.round(w);
  const hk = Math.round(h);
  const ck = Math.round(cornerR);
  const key = `${character.id}:${partType}:r:${wk}:${hk}:${ck}`;
  const hit = _cache.get(key);
  if (hit) {
    __cacheStats.hits++;
    return hit;
  }
  __cacheStats.misses++;
  const sprite = buildRectSprite(character, wk, hk, ck);
  _cache.set(key, sprite);
  __cacheStats.entries = _cache.size;
  return sprite;
}

function buildCircleSprite(character, partType, r) {
  const size = r * 2 + SPRITE_PAD * 2;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  ctx.translate(size / 2, size / 2);

  // Match drawSegment / drawHead in render/ragdoll.js verbatim for the
  // un-tinted case.
  let topCol, bottomCol, highlightY;
  if (partType === 'head') {
    topCol = lighten(character.body, 0.18);
    bottomCol = character.bodyDark;
    highlightY = -r * 0.30;
  } else {
    topCol = character.body;
    bottomCol = character.bodyDark;
    highlightY = -r * 0.35;
  }

  const grad = ctx.createRadialGradient(0, highlightY, 2, 0, 0, r);
  grad.addColorStop(0, topCol);
  grad.addColorStop(1, bottomCol);
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, Math.PI * 2);
  ctx.fill();

  return canvas;
}

function buildRectSprite(character, w, h, cornerR) {
  const sw = w + SPRITE_PAD * 2;
  const sh = h + SPRITE_PAD * 2;
  const canvas = document.createElement('canvas');
  canvas.width = sw;
  canvas.height = sh;
  const ctx = canvas.getContext('2d');
  ctx.translate(sw / 2, sh / 2);

  const grad = ctx.createLinearGradient(0, -h / 2, 0, h / 2);
  grad.addColorStop(0, character.body);
  grad.addColorStop(1, character.bodyDark);
  ctx.fillStyle = grad;
  ctx.beginPath();
  if (cornerR > 0 && ctx.roundRect) {
    ctx.roundRect(-w / 2, -h / 2, w, h, cornerR);
  } else {
    ctx.rect(-w / 2, -h / 2, w, h);
  }
  ctx.fill();

  return canvas;
}

// Duplicated from render/ragdoll.js (lines 315-322), keeping a private copy
// here avoids an import cycle and the helper is tiny.
function lighten(hex, amt) {
  const c = hex.replace('#', '');
  const num = parseInt(c, 16);
  const r = Math.min(255, ((num >> 16) & 0xff) + Math.round(255 * amt));
  const g = Math.min(255, ((num >> 8) & 0xff) + Math.round(255 * amt));
  const b = Math.min(255, (num & 0xff) + Math.round(255 * amt));
  return `rgb(${r},${g},${b})`;
}
