// Overview "bento" grid: the dashboard's home / landing surface. Each
// tile is a teaser of one drill-in section: large, glanceable, no axes,
// uses the section's pastel tone so the whole grid reads as one palette.
// Tile clicks are wired by the dashboard body binder; this module is
// pure rendering.

import { TOOLS_BY_ID } from '../tools-table.js';
import { smoothPath } from './charts.js';
import { renderAudienceAction } from './focused-layout.js';
import { escapeHTML, formatN, percentile } from './format.js';
import { DOW_LABELS } from './insights.js';
import { PERSONA_IDS, PERSONA_LABELS } from './persona-present.js';

// Per-section tone seeds the pastel tile background. The same hue gets
// reused inside the preview viz so the tile reads as one element.
const TILE_TONE = {
  activity: '#4285f4', // sky
  when:     '#fbbf24', // amber
  where:    '#fb7185', // rose
  tools:    '#10a37f', // mint
  buddies:  '#a78bfa', // lavender
  sessions: '#22d3ee', // cyan
  records:  '#f59e0b', // gold
  value:    '#84cc16', // lime
};

const TILE_DESC = {
  activity: ['Daily', 'mood balance.'],
  when:     ['Peak', 'play window.'],
  where:    ['Hit', 'location mix.'],
  tools:    ['Top', 'tool mix.'],
  buddies:  ['Buddy', 'attention share.'],
  sessions: ['Session', 'intensity.'],
  records:  ['Personal', 'highs.'],
  value:    ['Paid', 'tool return.'],
};

// The 8 tiles pack into a 4-column grid where two heroes (activity,
// buddies) span 2 cols; the remaining 6 are 1×1.
const TILE_SPAN = {
  activity: { col: 2, row: 1 },
  buddies:  { col: 2, row: 1 },
};

// Mix a hex color toward white. mix=0 returns the original; mix=1 returns
// pure white. Used to derive the soft per-tile tint without screaming
// saturation against the white surface.
function pastelize(hex, mix = 0.85) {
  if (typeof hex !== 'string' || hex[0] !== '#') return hex;
  const norm = hex.length === 4
    ? '#' + hex.slice(1).split('').map((c) => c + c).join('')
    : hex;
  const r = parseInt(norm.slice(1, 3), 16);
  const g = parseInt(norm.slice(3, 5), 16);
  const b = parseInt(norm.slice(5, 7), 16);
  const blend = (c) => Math.round(c + (255 - c) * mix);
  return `rgb(${blend(r)}, ${blend(g)}, ${blend(b)})`;
}

export function renderBento(ctx, visibleSections) {
  const drillTiles = visibleSections.filter((s) => s.id !== 'overview');
  const tiles = drillTiles.map((s, i) => renderTile(s, i, ctx)).join('');
  // Surface the benchmark toggle at the bottom of the bento so users can
  // enable global comparison without first drilling into a section. Same
  // pill, same data-bench-action wiring as focused-layout.
  return `
    <div class="sd-bento-wrap">
      <div class="sd-bento" role="list">
        ${tiles}
      </div>
      <div class="sd-bento-footer">${renderAudienceAction(ctx)}</div>
    </div>
  `;
}

function renderTile(section, index, ctx) {
  const num = String(index + 1).padStart(2, '0');
  const tone = TILE_TONE[section.id] || '#94a3b8';
  const span = TILE_SPAN[section.id] || { col: 1, row: 1 };
  const preview = renderTilePreview(section.id, ctx, tone);
  const desc = TILE_DESC[section.id] || '';
  const descHtml = Array.isArray(desc)
    ? `<strong>${escapeHTML(desc[0])}</strong> ${escapeHTML(desc[1] || '')}`
    : escapeHTML(desc);
  return `
    <button type="button" class="sd-tile" role="listitem"
            data-tile="${section.id}"
            style="--tile-tone:${tone}; --tile-tint:${pastelize(tone, 0.88)};"
            data-col="${span.col}" data-row="${span.row}">
      <span class="sd-tile-num" aria-label="Section ${num}">${num}</span>
      <div class="sd-tile-preview">${preview}</div>
      <div class="sd-tile-foot">
        <h3 class="sd-tile-title">${escapeHTML(section.label)}</h3>
        <p class="sd-tile-desc">${descHtml}</p>
      </div>
    </button>
  `;
}

// ---- Tile preview viz (mini) ------------------------------------------
//
// Each preview is a *teaser*: readability before fidelity. Headline +
// chips are the editorial readout; the SVG/CSS shape on the right is the
// visualization-reading caption space.

function renderTilePreview(id, ctx, tone) {
  const stats = ctx.stats || {};
  switch (id) {
    case 'activity': return previewActivity(stats, tone, ctx.previous);
    case 'when':     return previewWhen(stats, tone);
    case 'where':    return previewWhere(stats, tone);
    case 'tools':    return previewTools(stats, tone);
    case 'buddies':  return previewBuddies(stats, tone);
    case 'sessions': return previewSessions(stats, tone);
    case 'records':  return previewRecords(stats, tone);
    case 'value':    return previewValue(stats, tone);
    default:         return '';
  }
}

function previewActivity(stats, tone, previous) {
  const buckets = stats.timeseries || [];
  if (buckets.length < 2) return tilePlaceholder('No daily rhythm yet.');
  const help = buckets.map((b) => Number(b.help_mood || 0));
  const hurt = buckets.map((b) => Number(b.hurt_mood || 0));
  const net = help.map((v, i) => v - (hurt[i] || 0));
  const netTotal = net.reduce((a, b) => a + b, 0);
  const actions = buckets.reduce((sum, b) => sum + Number(b.fires || 0) + Number(b.hits || 0), 0);
  const headline = Math.abs(netTotal) >= Math.max(10, actions * 0.05)
    ? `${netTotal > 0 ? '+' : ''}${formatN(netTotal)} net mood`
    : `${formatN(actions)} interactions`;
  const prevTotals = previous?.totals || {};
  const prevNet = Number(prevTotals.help_mood || 0) - Number(prevTotals.hurt_mood || 0);
  const chips = previous
    ? [plainDelta(netTotal, prevNet), `${formatN(actions)} interactions`]
    : [`+${formatN(help.reduce((a, b) => a + b, 0))}`, `-${formatN(hurt.reduce((a, b) => a + b, 0))}`];
  return tileInsight(headline, chips, balanceWave(net, help, hurt, tone));
}

function previewWhen(stats, tone) {
  const tod = stats.time_of_day_heatmap || [];
  if (tod.length === 0) return tilePlaceholder('No cadence yet.');
  const grid = Array.from({ length: 7 }, () => new Array(8).fill(0));
  let max = 0;
  let peak = { dow: 0, col: 0, value: 0 };
  for (const cell of tod) {
    const col = Math.floor(cell.hour / 3);
    const v = (cell.fires || 0) + (cell.hits || 0);
    grid[cell.dow][col] += v;
    if (grid[cell.dow][col] > max) max = grid[cell.dow][col];
    if (grid[cell.dow][col] > peak.value) peak = { dow: cell.dow, col, value: grid[cell.dow][col] };
  }
  if (max === 0) return tilePlaceholder('No cadence yet.');
  const dayTotals = grid.map((row) => row.reduce((a, b) => a + b, 0));
  const dayIndex = dayTotals.indexOf(Math.max(...dayTotals));
  const startHour = peak.col * 3;
  const endHour = startHour + 3;
  const cells = grid.flatMap((row) => row.map((v) => {
    const i = max ? Math.min(1, v / max) : 0;
    return `<span class="sd-tile-cell" style="opacity:${(0.18 + i * 0.82).toFixed(2)};"></span>`;
  })).join('');
  return tileInsight(
    `${DOW_LABELS[peak.dow]} ${String(startHour).padStart(2, '0')}:00`,
    [`${formatN(peak.value)} interactions`, `${String(startHour).padStart(2, '0')}-${String(endHour).padStart(2, '0')}`, `${DOW_LABELS[dayIndex]} busiest`],
    `<div class="sd-tile-mini-grid" style="--tile-tone:${tone};">${cells}</div>`,
  );
}

function previewWhere(stats, tone) {
  const heatmap = stats.hit_heatmap || [];
  if (heatmap.length === 0) return tilePlaceholder('No hits yet.');
  const counts = { head: 0, torso: 0, arm: 0, leg: 0 };
  for (const r of heatmap) counts[r.part] = (counts[r.part] || 0) + (r.count || 0);
  const rows = [
    ['head', counts.head],
    ['torso', counts.torso],
    ['arm', counts.arm],
    ['leg', counts.leg],
  ].sort((a, b) => b[1] - a[1]);
  const top = rows[0];
  const total = rows.reduce((sum, r) => sum + r[1], 0) || 1;
  const topShare = Math.round((top[1] / total) * 100);
  return tileInsight(
    `${titleCasePart(top[0])}: ${topShare}%`,
    [`${formatN(top[1])} hits`, `${formatN(total)} total`],
    locationBars(rows, total, tone),
  );
}

function previewTools(stats, tone) {
  const allRows = Object.entries(stats.per_verb || {})
    .map(([id, r]) => ({ id, total: (r.fires || 0) + (r.hits || 0), label: TOOLS_BY_ID[id]?.label || id }))
    .filter((r) => r.total > 0)
    .sort((a, b) => b.total - a.total);
  const rows = allRows.slice(0, 3);
  if (rows.length === 0) return tilePlaceholder('No tools used yet.');
  const total = allRows.reduce((sum, r) => sum + r.total, 0) || 1;
  const topShare = Math.round((rows[0].total / total) * 100);
  return tileInsight(
    `${rows[0].label} leads`,
    [`${topShare}% share`, `${formatN(rows[0].total)} uses`],
    rankedBars(rows.map((r) => ({ label: r.label, value: r.total, cap: `${Math.round((r.total / total) * 100)}%` })), tone),
  );
}

function previewBuddies(stats, tone) {
  const perModel = stats.per_model || {};
  const rows = PERSONA_IDS.map((id) => {
    const m = perModel[id] || {};
    const total = Number(m.fires || 0) + Number(m.hits || 0);
    return { id, total };
  }).filter((r) => r.total > 0).sort((a, b) => b.total - a.total).slice(0, 6);
  if (rows.length === 0) return tilePlaceholder('No buddy data yet.');
  const total = rows.reduce((sum, r) => sum + r.total, 0) || 1;
  const top = rows[0];
  const topShare = Math.round((top.total / total) * 100);
  return tileInsight(
    `${PERSONA_LABELS[top.id] || top.id} leads`,
    [`${topShare}% share`, `${formatN(top.total)} interactions`],
    rankedBars(rows.slice(0, 3).map((r) => ({
      label: PERSONA_LABELS[r.id] || r.id,
      value: r.total,
      cap: `${Math.round((r.total / total) * 100)}%`,
    })), tone),
  );
}

function previewSessions(stats, tone) {
  const sessions = (stats.session_summaries || []).filter((s) => (s.fires + s.hits) > 0);
  if (sessions.length === 0) return tilePlaceholder('No sessions yet.');
  const totals = sessions.map((s) => s.fires + s.hits);
  const sorted = [...totals].sort((a, b) => a - b);
  const avg = totals.reduce((a, b) => a + b, 0) / totals.length;
  const median = percentile(sorted, 0.5);
  return tileInsight(
    `${formatN(sessions.length)} sessions`,
    [`median ${formatN(Math.round(median))}`, `avg ${formatN(Math.round(avg))}`],
    sessionHistogram(totals, tone),
  );
}

function previewRecords(stats, tone) {
  const r = stats.records || {};
  const combo = Number(r.longest_combo || 0);
  const biggestSession = Math.max(
    0,
    ...((stats.session_summaries || []).map((s) => Number(s.fires || 0) + Number(s.hits || 0))),
    Number(r.biggest_session_help || 0),
    Number(r.biggest_session_hurt || 0),
  );
  const streak = longestActiveStreak(stats.daily_calendar || []);
  const rows = [
    ['Combo', combo ? formatN(combo) : '—'],
    ['Big session', biggestSession ? formatN(biggestSession) : '—'],
    ['Best streak', streak ? `${formatN(streak)}d` : '—'],
  ];
  if (!combo && !biggestSession && !streak) return tilePlaceholder('No records yet.');
  return tileInsight(
    combo ? `${formatN(combo)} combo` : `${formatN(biggestSession)} interactions`,
    combo ? ['longest chain'] : ['biggest session'],
    metricStack(rows, tone),
  );
}

function previewValue(stats, tone) {
  const rows = Object.entries(stats.per_verb || {}).map(([id, r]) => {
    const tool = TOOLS_BY_ID[id];
    if (!tool || !tool.cost) return null;
    const moodMag = Math.abs(r.mood_delta_sum || 0);
    if (moodMag <= 0) return null;
    return { label: tool.label, ratio: moodMag / tool.cost, moodMag };
  }).filter(Boolean).sort((a, b) => b.ratio - a.ratio).slice(0, 3);
  if (rows.length === 0) return tilePlaceholder('Use paid tools to populate.');
  const top = rows[0];
  const quality = top.ratio >= 1 ? 'strong return' : top.ratio >= 0.25 ? 'useful return' : 'low signal';
  return tileInsight(
    `${top.label}: ${top.ratio.toFixed(1)}`,
    [quality, 'mood per coin'],
    rankedBars(rows.map((r) => ({ label: r.label, value: r.ratio, cap: r.ratio.toFixed(1) })), tone),
  );
}

// ---- Preview viz primitives ------------------------------------------

function tileInsight(headline, chips, viz) {
  const chipList = Array.isArray(chips) ? chips.filter(Boolean) : [chips].filter(Boolean);
  return `
    <div class="sd-tile-insight">
      <div class="sd-tile-insight-copy">
        <div class="sd-tile-headline">${escapeHTML(headline)}</div>
        <div class="sd-tile-chips">${chipList.map((chip) => `<span>${escapeHTML(chip)}</span>`).join('')}</div>
      </div>
      <div class="sd-tile-viz">${viz}</div>
    </div>
  `;
}

function balanceWave(net, help, hurt, tone) {
  const W = 240;
  const H = 54;
  const mid = 27;
  const maxMood = Math.max(1, ...help.map((v, i) => Math.max(Math.abs(v), Math.abs(hurt[i] || 0), Math.abs(net[i] || 0))));
  const barW = W / Math.max(1, net.length);
  const bars = net.map((_, i) => {
    const pos = Math.max(0, Number(help[i] || 0));
    const neg = Math.max(0, Number(hurt[i] || 0));
    const x = i * barW + 1;
    const upH = Math.min(mid - 4, (pos / maxMood) * (mid - 5));
    const downH = Math.min(H - mid - 4, (neg / maxMood) * (H - mid - 5));
    return `
      <rect x="${x.toFixed(2)}" y="${(mid - upH).toFixed(2)}" width="${Math.max(1, barW - 2).toFixed(2)}" height="${upH.toFixed(2)}" rx="1.5" fill="${tone}" opacity="0.32"/>
      <rect x="${x.toFixed(2)}" y="${mid.toFixed(2)}" width="${Math.max(1, barW - 2).toFixed(2)}" height="${downH.toFixed(2)}" rx="1.5" fill="${tone}" opacity="0.14"/>
    `;
  }).join('');
  const lineMax = Math.max(1, ...net.map((v) => Math.abs(Number(v || 0))));
  const points = net.map((v, i) => ({
    x: (i / Math.max(1, net.length - 1)) * W,
    y: mid - (Number(v || 0) / lineMax) * (mid - 6),
  }));
  const linePath = smoothPath(points);
  return `
    <svg class="sd-balance-wave" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true">
      <line x1="0" y1="${mid}" x2="${W}" y2="${mid}" stroke="${tone}" stroke-opacity="0.2" stroke-dasharray="3 5" vector-effect="non-scaling-stroke"/>
      ${bars}
      <path d="${linePath}" fill="none" stroke="${tone}" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" vector-effect="non-scaling-stroke"/>
    </svg>
  `;
}

function locationBars(rows, total, tone) {
  const max = Math.max(1, ...rows.map((r) => r[1]));
  return `
    <div class="sd-location-bars" style="--tone:${tone};">
      ${rows.map(([part, value], i) => `
        <div class="sd-location-row" style="--pct:${((value / max) * 100).toFixed(2)}%; --alpha:${(0.88 - i * 0.13).toFixed(2)};">
          <span>${escapeHTML(titleCasePart(part))}</span>
          <i></i>
          <b>${Math.round((value / total) * 100)}%</b>
        </div>
      `).join('')}
    </div>
  `;
}

function rankedBars(rows, tone) {
  const max = Math.max(1, ...rows.map((r) => Number(r.value || 0)));
  return `
    <div class="sd-ranked-bars" style="--tone:${tone};">
      ${rows.map((r, i) => {
        return `
          <div class="sd-ranked-row" style="--pct:${((Number(r.value || 0) / max) * 100).toFixed(2)}%; --alpha:${(0.86 - i * 0.16).toFixed(2)};">
            <span>${escapeHTML(r.label)}</span>
            <i></i>
            <b>${escapeHTML(r.cap)}</b>
          </div>
        `;
      }).join('')}
    </div>
  `;
}

function sessionHistogram(values, tone) {
  const rows = [...values].filter((v) => Number(v) > 0).sort((a, b) => a - b);
  if (rows.length === 0) return `<div class="sd-session-histogram"></div>`;
  const max = Math.max(1, rows[rows.length - 1]);
  const bins = new Array(6).fill(0);
  for (const v of rows) {
    const idx = Math.min(bins.length - 1, Math.floor((v / max) * bins.length));
    bins[idx]++;
  }
  const maxBin = Math.max(1, ...bins);
  return `
    <div class="sd-session-histogram" style="--tone:${tone};">
      ${bins.map((count, i) => `<i style="--h:${(18 + (count / maxBin) * 72).toFixed(2)}%; --alpha:${(0.22 + i * 0.1).toFixed(2)};"></i>`).join('')}
    </div>
  `;
}

function metricStack(rows, tone) {
  return `
    <div class="sd-metric-stack" style="--tone:${tone};">
      ${rows.map(([label, value]) => `
        <div>
          <b>${escapeHTML(value)}</b>
          <span>${escapeHTML(label)}</span>
        </div>
      `).join('')}
    </div>
  `;
}

function longestActiveStreak(cal) {
  const dates = [...(cal || [])]
    .filter((d) => Number(d.fires || 0) + Number(d.hits || 0) > 0)
    .map((d) => d.date)
    .sort();
  if (dates.length === 0) return 0;
  let best = 1;
  let run = 1;
  for (let i = 1; i < dates.length; i++) {
    const prev = Date.parse(`${dates[i - 1]}T00:00:00Z`);
    const curr = Date.parse(`${dates[i]}T00:00:00Z`);
    if (curr - prev === 86_400_000) run++;
    else run = 1;
    if (run > best) best = run;
  }
  return best;
}

function plainDelta(curr, prev) {
  const a = Number(curr || 0);
  const b = Number(prev || 0);
  if (!b) return a ? 'new' : 'flat';
  const diff = a - b;
  const pct = Math.round((Math.abs(diff) / Math.max(1, Math.abs(b))) * 100);
  if (!pct) return 'flat';
  return `${diff > 0 ? 'up' : 'down'} ${pct}%`;
}

function titleCasePart(part) {
  return String(part || '').replace(/^\w/, (c) => c.toUpperCase());
}

function tilePlaceholder(msg) {
  return `<div class="sd-tile-empty">${escapeHTML(msg)}</div>`;
}
