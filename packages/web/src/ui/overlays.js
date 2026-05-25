// Stage overlays, anvil drop silhouette, blackhole spinner, screen flash,
// nuke white-out, combo pop. CSS animations are defined in src/style.css.

function overlayLayer() { return document.getElementById('stage-overlays'); }

// Anvil silhouette drops from above onto (x, y), squashes, and fades.
// Pair with the actual physics body in abilities.js, the visual is dressing.
export function showAnvilDrop(x, y) {
  const layer = overlayLayer(); if (!layer) return;
  const el = document.createElement('div');
  el.className = 'overlay anvil';
  el.style.left = `${x}px`;
  el.style.top  = `${y}px`;
  layer.appendChild(el);
  setTimeout(() => el.remove(), 700);
}

// Spinning gravity well at (x, y). durationMs default 3s matches design.
export function showBlackHole(x, y, durationMs = 3000) {
  const layer = overlayLayer(); if (!layer) return;
  const el = document.createElement('div');
  el.className = 'overlay blackhole';
  el.style.left = `${x}px`;
  el.style.top  = `${y}px`;
  el.style.setProperty('--bh-time', `${durationMs}ms`);
  layer.appendChild(el);
  setTimeout(() => el.remove(), durationMs);
}

// Quick full-screen colored flash (lightning, shatter, etc.).
// durationMs default 90 = "flash-burn" feel without epileptic strobing.
export function showFlash(color = '#ffffff', durationMs = 90, peakAlpha = 0.85) {
  const layer = overlayLayer(); if (!layer) return;
  const el = document.createElement('div');
  el.className = 'overlay flash';
  el.style.background = color;
  el.style.setProperty('--flash-dur', `${durationMs}ms`);
  el.style.setProperty('--flash-peak', String(peakAlpha));
  layer.appendChild(el);
  setTimeout(() => el.remove(), durationMs + 20);
}

// White-out nuke flash + slow burn-in fade.
export function showNuke() {
  const layer = overlayLayer(); if (!layer) return;
  const el = document.createElement('div');
  el.className = 'overlay nuke-flash';
  layer.appendChild(el);
  setTimeout(() => el.remove(), 1600);
}

// Combo text intentionally disabled, the giant centered "CONCUSSED!" /
// "SHATTER!" overlays were visual noise. Export kept as a no-op so the
// ~10 call sites (abilities + effects + panic moves + modes) stay valid.
export function showCombo() {}
