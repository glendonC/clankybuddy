// Currency display. Subscribes to progression state and tweens the
// rendered number toward the actual balance with an ease-out-expo curve,
// so earnings feel like flow rather than flicker. No accent pulse, no
// shadow drama, the digits just resolve.

import { onChange as onProgressionChange } from '../progression/state.js';

const TWEEN_MIN_MS = 220;
const TWEEN_MAX_MS = 520;

const ease = (t) => (t === 1 ? 1 : 1 - Math.pow(2, -10 * t));

export function bindCurrencyHud(amountEl) {
  const el = amountEl ?? document.getElementById('currency-amount');
  if (!el) return;

  let displayed = 0;
  let target = 0;
  let tweenFrom = 0;
  let tweenStart = 0;
  let tweenDuration = 0;
  let rafId = null;
  let primed = false;

  function frame(now) {
    const t = Math.min(1, (now - tweenStart) / tweenDuration);
    displayed = tweenFrom + (target - tweenFrom) * ease(t);
    el.textContent = Math.round(displayed).toLocaleString();
    if (t < 1) {
      rafId = requestAnimationFrame(frame);
    } else {
      displayed = target;
      el.textContent = target.toLocaleString();
      rafId = null;
    }
  }

  function retarget(next) {
    if (next === target) return;
    const delta = Math.abs(next - displayed);
    tweenDuration = Math.min(TWEEN_MAX_MS,
                             Math.max(TWEEN_MIN_MS, 220 + delta * 1.2));
    tweenFrom = displayed;
    target = next;
    tweenStart = performance.now();
    if (rafId == null) rafId = requestAnimationFrame(frame);
  }

  onProgressionChange((s) => {
    const next = s.currency ?? 0;
    if (!primed) {
      primed = true;
      displayed = target = next;
      el.textContent = next.toLocaleString();
      return;
    }
    retarget(next);
  });
}
