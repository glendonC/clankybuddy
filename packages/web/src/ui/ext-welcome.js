// In-panel welcome card for the VS Code extension's first launch.
// Gated on window.__clankybuddyExtConfig.firstRun, never renders in the
// normal web build. Brand-styled squircle overlay; dismisses on CTA click,
// outside-click, Escape, or first canvas interaction.

const DISMISS_KEY = 'clankybuddy.extWelcomeDismissed.v1';

let _root = null;

export function bindExtWelcome() {
  const cfg = (typeof window !== 'undefined') ? window.__clankybuddyExtConfig : null;
  if (!cfg || !cfg.firstRun) return;

  // Belt-and-suspenders: the extension already tracks first-run, but if the
  // panel gets reloaded with the flag still set we don't want to spam users
  // across reloads in the same session.
  try {
    if (sessionStorage.getItem(DISMISS_KEY) === '1') return;
  } catch { /* sessionStorage blocked → fall through, render once */ }

  // Defer one frame so the canvas + chrome have mounted underneath.
  requestAnimationFrame(open);
}

function open() {
  if (_root) return;
  _root = document.createElement('div');
  _root.className = 'ext-welcome-backdrop';
  _root.setAttribute('role', 'dialog');
  _root.setAttribute('aria-modal', 'true');
  _root.setAttribute('aria-labelledby', 'ext-welcome-title');
  _root.innerHTML = `
    <div class="ext-welcome-card">
      <button class="ext-welcome-close" aria-label="Dismiss">×</button>
      <div class="ext-welcome-eyebrow"><span class="dot"></span><span>clankybuddy</span></div>
      <h2 id="ext-welcome-title" class="ext-welcome-title">your buddy is here</h2>
      <p class="ext-welcome-sub">a punching bag (or a pet) for whichever AI is currently driving you up the wall.</p>
      <div class="ext-welcome-rows">
        <div class="ext-welcome-row">
          <div class="glyph">⊕</div>
          <div class="text">
            <div class="k">click anywhere to interact</div>
            <div class="v">drag tools from the hotbar, smack the buddy, see what happens.</div>
          </div>
        </div>
        <div class="ext-welcome-row">
          <div class="glyph">↻</div>
          <div class="text">
            <div class="k">cycle buddies, top-right</div>
            <div class="v">claude · gpt · gemini · grok · llama · deepseek, each one has its own voice.</div>
          </div>
        </div>
        <div class="ext-welcome-row">
          <div class="glyph">⏱</div>
          <div class="text">
            <div class="k">optional nudge during coding</div>
            <div class="v">set <em>ClankyBuddy → Nudge: Interval Minutes</em> in vscode settings. 0 = off.</div>
          </div>
        </div>
      </div>
      <button class="ext-welcome-cta" type="button">let's go</button>
    </div>
  `;
  document.body.appendChild(_root);

  const card = _root.querySelector('.ext-welcome-card');
  _root.querySelector('.ext-welcome-cta').addEventListener('click', close);
  _root.querySelector('.ext-welcome-close').addEventListener('click', close);
  _root.addEventListener('click', (e) => { if (e.target === _root) close(); });
  card.addEventListener('click', (e) => e.stopPropagation());

  window.addEventListener('keydown', onKey, true);

  // Dismiss on first canvas interaction, they've already engaged, the card
  // is in their way at that point.
  const canvas = document.querySelector('canvas');
  if (canvas) canvas.addEventListener('pointerdown', close, { once: true, capture: true });
}

function onKey(e) {
  if (e.key === 'Escape' && _root) {
    e.preventDefault();
    close();
  }
}

function close() {
  if (!_root) return;
  try { sessionStorage.setItem(DISMISS_KEY, '1'); } catch { /* noop */ }
  _root.classList.add('is-dismissing');
  window.removeEventListener('keydown', onKey, true);
  const node = _root;
  _root = null;
  setTimeout(() => node.remove(), 160);
}
