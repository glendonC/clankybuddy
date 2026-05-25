// Shared chrome helpers used by every src/personas/<id>.js file. Builds a
// preloaded <Image> from an SVG string (with optional fill tint) and
// renders it centered on the head circle. Logos that need to render in
// their authored colors (Gemini's gradient) pass tint=null.

// Build a preloaded <Image> from an SVG string. Monochrome SVGs use
// fill="currentColor"; we substitute the desired tint there. Multicolor
// SVGs (Gemini gradient) pass tint=null to render as-authored.
export function makeLogoImage(svg, tint) {
  const tinted = tint ? svg.replace(/currentColor/g, tint) : svg;
  const img = new Image();
  img.src = 'data:image/svg+xml;utf8,' + encodeURIComponent(tinted);
  return img;
}

// Render the char's logo image centered at (0,0) (caller already translated
// to head center). Logo fills ~75% of the head circle. If the image isn't
// loaded yet, draw nothing this frame, it'll appear next tick.
export function drawLogoImg(ctx, r, img) {
  if (!img.complete || img.naturalWidth === 0) return;
  const size = r * 1.5;
  ctx.drawImage(img, -size / 2, -size / 2, size, size);
}
