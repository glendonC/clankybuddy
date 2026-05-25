// Lightweight particle system, pos, vel, life, type, color, size.

const particles = [];

export function spawn(opts) {
  const p = {
    x: opts.x, y: opts.y,
    vx: opts.vx ?? 0, vy: opts.vy ?? 0,
    life: opts.life ?? 600,
    age: 0,
    type: opts.type ?? 'spark',
    color: opts.color ?? '#fff',
    size: opts.size ?? 3,
    gravity: opts.gravity ?? 0.0006,
    drag: opts.drag ?? 0.998,
    rot: opts.rot ?? 0,
    spin: opts.spin ?? (Math.random() - .5) * 0.2,
  };
  particles.push(p);
  return p;
}

export function burst(x, y, count, opts) {
  for (let i = 0; i < count; i++) {
    const a = Math.random() * Math.PI * 2;
    const speed = (opts?.speedMin ?? 0.05) + Math.random() * (opts?.speedRange ?? 0.4);
    spawn({
      x, y,
      vx: Math.cos(a) * speed,
      vy: Math.sin(a) * speed,
      ...opts,
    });
  }
}

// Reference frame for dt-scaled drag/spin: 60 Hz (16.667 ms/frame). The
// `drag` and `spin` values in spawn() are expressed per-reference-frame,
// then exponentiated by (dt / referenceDt) so the same particle visually
// settles at the same rate on a 60Hz vs 144Hz monitor. Without this the
// drag multiplier (~0.998) is applied once per frame regardless of
// elapsed time, at 144Hz that's ~5× more drag-passes per second.
const REFERENCE_FRAME_MS = 1000 / 60;

export function update(dtMs) {
  const frames = dtMs / REFERENCE_FRAME_MS;
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    p.age += dtMs;
    if (p.age >= p.life) { particles.splice(i, 1); continue; }
    p.x += p.vx * dtMs;
    p.y += p.vy * dtMs;
    p.vy += p.gravity * dtMs;
    // dt-scaled drag: Math.pow lets the same drag value reach the same
    // velocity over the same wall-clock time at any framerate.
    const dragK = p.drag === 1 ? 1 : Math.pow(p.drag, frames);
    p.vx *= dragK;
    p.vy *= dragK;
    p.rot += p.spin * frames;
  }
}

export function render(ctx) {
  for (const p of particles) {
    const t = p.age / p.life;
    const alpha = 1 - t;
    ctx.save();
    ctx.globalAlpha = Math.max(0, alpha);
    ctx.translate(p.x, p.y);
    ctx.rotate(p.rot);
    switch (p.type) {
      case 'heart':
        drawHeart(ctx, p.size, p.color); break;
      case 'spark':
        ctx.fillStyle = p.color;
        ctx.fillRect(-p.size/2, -p.size/2, p.size, p.size); break;
      case 'fire':
        const grad = ctx.createRadialGradient(0,0,0, 0,0, p.size);
        grad.addColorStop(0, '#fff7c2');
        grad.addColorStop(0.4, p.color);
        grad.addColorStop(1, 'rgba(255,80,0,0)');
        ctx.fillStyle = grad;
        ctx.beginPath(); ctx.arc(0, 0, p.size, 0, Math.PI*2); ctx.fill();
        break;
      case 'smoke':
        ctx.fillStyle = `rgba(70,70,80,${alpha*0.6})`;
        ctx.beginPath(); ctx.arc(0, 0, p.size * (1 + t*1.5), 0, Math.PI*2); ctx.fill();
        break;
      case 'ice':
        ctx.fillStyle = p.color;
        ctx.beginPath();
        for (let i = 0; i < 6; i++) {
          const a = (i/6) * Math.PI*2;
          ctx.lineTo(Math.cos(a)*p.size, Math.sin(a)*p.size);
        }
        ctx.closePath(); ctx.fill();
        break;
      case 'star':
        drawStar(ctx, p.size, p.color); break;
      case 'bullet':
        ctx.fillStyle = p.color;
        ctx.beginPath(); ctx.ellipse(0,0, p.size*1.6, p.size*0.5, 0, 0, Math.PI*2); ctx.fill();
        break;
      default:
        ctx.fillStyle = p.color;
        ctx.beginPath(); ctx.arc(0,0, p.size, 0, Math.PI*2); ctx.fill();
    }
    ctx.restore();
  }
}

function drawHeart(ctx, s, color) {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(0, s * 0.4);
  ctx.bezierCurveTo(s, -s*0.2, s*0.6, -s, 0, -s*0.3);
  ctx.bezierCurveTo(-s*0.6, -s, -s, -s*0.2, 0, s*0.4);
  ctx.closePath();
  ctx.fill();
}

function drawStar(ctx, s, color) {
  ctx.fillStyle = color;
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const r = (i % 2 === 0) ? s : s * 0.45;
    const a = (i / 10) * Math.PI * 2 - Math.PI / 2;
    ctx.lineTo(Math.cos(a)*r, Math.sin(a)*r);
  }
  ctx.closePath();
  ctx.fill();
}

export function clear() { particles.length = 0; }
