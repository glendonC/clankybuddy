import { escapeHTML, formatInlineEmphasis } from './format.js';

// Half-filled globe, reads as "comparative / partial view." Active state
// fills the other half so the icon visibly toggles with the button state.
const GLOBE_ICON = `
  <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" fill="none">
    <circle cx="8" cy="8" r="6.5" stroke="currentColor" stroke-width="1.25"/>
    <ellipse cx="8" cy="8" rx="3.4" ry="6.5" stroke="currentColor" stroke-width="1.1"/>
    <line x1="1.5" y1="8" x2="14.5" y2="8" stroke="currentColor" stroke-width="1.1"/>
    <path d="M8 1.5a6.5 6.5 0 0 1 0 13" fill="currentColor" opacity="0.85"/>
  </svg>
`;

// Benchmark toggle: pill-shaped action sitting at the bottom of the focused
// editorial readout. Toggles `dataset.benchmarkOn` rather than swapping the
// audience, the global view is layered onto personal data instead of
// replacing it. Hidden on `myOnly` sections (sessions/records/value) where
// there is no global counterpart anyway.
export function renderAudienceAction(ctx, myOnly = false) {
  if (myOnly) return '';
  const on = !!ctx?.benchmarkOn;
  const label = on ? 'Hide global benchmark' : 'Compare globally';
  const detail = on
    ? 'Remove the global overlay from the charts and KPI strip.'
    : 'Layer global benchmark data onto your view.';
  return `
    <button type="button" class="sd-audience-action ${on ? 'is-on' : ''}"
            data-bench-action
            aria-pressed="${on ? 'true' : 'false'}"
            data-tip="${escapeHTML(detail)}" aria-label="${escapeHTML(label)}. ${escapeHTML(detail)}">
      <span class="sd-audience-icon">${GLOBE_ICON}</span>
      <span class="sd-audience-label">${escapeHTML(label)}</span>
    </button>
  `;
}

// Drilled-in layout: full-width visualization first, then a large editorial
// readout underneath. Chart-reading stays near the chart; interpretation stays
// in the result text.
export function focusedLayout({ id, eyebrow, title, big, bigCap, takeaway, copy, viz, vizNote, ctx, myOnly = false }) {
  const audience = renderAudienceAction(ctx, myOnly);
  return `
    <section class="sd-section sd-section-focused" data-section="${id}">
      <div class="sd-focused-stack">
        <div class="sd-focused-viz">
          <div class="sd-focused-viz-body">${viz}</div>
          ${vizNote ? `<p class="sd-focused-viz-note">${formatInlineEmphasis(vizNote)}</p>` : ''}
        </div>
        <aside class="sd-focused-text" ${eyebrow ? `aria-label="${escapeHTML(eyebrow)}"` : ''}>
          <div class="sd-focused-metric">
            ${big ? `<div class="sd-focused-big">${big}</div>` : ''}
            ${bigCap ? `<div class="sd-focused-bigcap">${formatInlineEmphasis(bigCap)}</div>` : ''}
          </div>
          ${(takeaway || copy) ? `
            <div class="sd-focused-brief">
              ${takeaway ? `<p class="sd-focused-takeaway">${formatInlineEmphasis(takeaway)}</p>` : ''}
              ${copy ? `<p class="sd-focused-copy">${formatInlineEmphasis(copy)}</p>` : ''}
            </div>
          ` : ''}
          ${audience}
        </aside>
      </div>
    </section>
  `;
}
