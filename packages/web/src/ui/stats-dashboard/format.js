export function stripTagText(html) {
  return String(html).replace(/<[^>]*>/g, '').trim();
}

export function pluralize(n, one, many = `${one}s`) {
  return Number(n) === 1 ? one : many;
}

export function formatPct(numerator, denominator) {
  if (!denominator) return 0;
  return Math.round((Number(numerator || 0) / Number(denominator || 1)) * 100);
}

export function formatN(value) {
  if (value === null || value === undefined) return '—';
  if (typeof value === 'string') return escapeHTML(value);
  const n = Number(value);
  if (!Number.isFinite(n)) return '—';
  return n.toLocaleString();
}

export function formatDuration(ms) {
  const total = Math.max(0, Math.round(Number(ms || 0) / 1000));
  if (total === 0 && (ms == null)) return '—';
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h) return `${h}h ${m}m`;
  if (m) return `${m}m ${s}s`;
  return `${s}s`;
}

export function formatBucketLabel(ts) {
  const t = Number(ts || 0);
  if (!t) return '';
  const d = new Date(t);
  const now = Date.now();
  const dayMs = 86_400_000;
  if (now - t < 2 * dayMs) {
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  }
  return `${d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`;
}

export function percentile(sortedValues, q) {
  if (!sortedValues.length) return 0;
  const idx = (sortedValues.length - 1) * q;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sortedValues[lo];
  return sortedValues[lo] + (sortedValues[hi] - sortedValues[lo]) * (idx - lo);
}

export function deltaInline(curr, prev) {
  const a = Number(curr || 0);
  const b = Number(prev || 0);
  if (!a && !b) return '<span class="sd-delta sd-delta-zero">—</span>';
  if (!b) return '<span class="sd-delta sd-delta-up">new</span>';
  const diff = a - b;
  const pct = Math.round((diff / b) * 100);
  if (pct === 0) return '<span class="sd-delta sd-delta-zero">—</span>';
  if (pct > 0) return `<span class="sd-delta sd-delta-up">↑ ${pct}%</span>`;
  return `<span class="sd-delta sd-delta-down">↓ ${Math.abs(pct)}%</span>`;
}

export function escapeHTML(s) {
  return String(s).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

export function formatInlineEmphasis(text) {
  return escapeHTML(text)
    .replace(/__([^_]+?)__/g, (_, raw) => {
      const [label, customTip] = String(raw).split('|');
      const tip = customTip || insightTipFor(label);
      return `<span class="sd-inline-underline" data-tip="${escapeHTML(tip)}">${label}</span>`;
    })
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
}

function insightTipFor(label) {
  const key = String(label || '').toLowerCase();
  if (key.includes('net mood')) {
    return 'Net mood = Help mood minus Hurt mood. Positive means the range leaned helpful; negative means harmful.';
  }
  if (key.includes('mood impact')) {
    return 'Mood impact = sum of mood deltas across every recorded use. Positive helped; negative hurt.';
  }
  if (key.includes('share')) {
    return 'Share = this item divided by the visible total. Shown as a percentage of the row.';
  }
  if (key.includes('trend')) {
    return 'Trend line = interaction count plotted across the selected range.';
  }
  return 'Underlined values show the calculation behind them on hover.';
}
