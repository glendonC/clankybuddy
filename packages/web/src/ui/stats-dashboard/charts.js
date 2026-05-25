let _gradUid = 0;

export function gradientSparkline(series, { accent = 'var(--ink)', height = 56, lineWidth = 1.5 } = {}) {
  if (!Array.isArray(series) || series.length < 2 || series.every((v) => !v)) {
    return `<svg class="sd-spark sd-spark-empty" viewBox="0 0 240 ${height}" preserveAspectRatio="none">
      <line x1="0" y1="${height / 2}" x2="240" y2="${height / 2}" stroke="${accent}" stroke-opacity=".18" stroke-dasharray="2 4" stroke-width="1" vector-effect="non-scaling-stroke"/>
    </svg>`;
  }
  const W = 240;
  const H = height;
  const padTop = 4;
  const padBottom = 2;
  const usableH = H - padTop - padBottom;
  const max = Math.max(...series.map((v) => Number(v) || 0));
  const min = Math.min(0, ...series.map((v) => Number(v) || 0));
  const range = max - min || 1;
  const xAt = (i) => (i / (series.length - 1)) * W;
  const yAt = (v) => padTop + (1 - (Number(v || 0) - min) / range) * usableH;
  const points = series.map((v, i) => ({ x: xAt(i), y: yAt(v) }));
  const linePath = smoothPath(points);
  const fillPath = `${linePath} L ${points[points.length - 1].x.toFixed(2)} ${H} L ${points[0].x.toFixed(2)} ${H} Z`;
  const last = points[points.length - 1];
  const uid = `sd-grad-${++_gradUid}`;
  return `
    <svg class="sd-spark" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">
      <defs>
        <linearGradient id="${uid}" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stop-color="${accent}" stop-opacity="0.42"/>
          <stop offset="100%" stop-color="${accent}" stop-opacity="0"/>
        </linearGradient>
      </defs>
      <path d="${fillPath}" fill="url(#${uid})"/>
      <path d="${linePath}" fill="none" stroke="${accent}" stroke-width="${lineWidth}"
            stroke-linecap="round" stroke-linejoin="round" vector-effect="non-scaling-stroke"/>
      <circle cx="${last.x.toFixed(2)}" cy="${last.y.toFixed(2)}" r="2" fill="${accent}"/>
    </svg>
  `;
}

export function smoothPath(points) {
  if (!points.length) return '';
  if (points.length === 1) return `M ${points[0].x.toFixed(2)} ${points[0].y.toFixed(2)}`;
  let d = `M ${points[0].x.toFixed(2)} ${points[0].y.toFixed(2)}`;
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[i - 1] || points[i];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[i + 2] || p2;
    const c1x = p1.x + (p2.x - p0.x) / 6;
    const c1y = p1.y + (p2.y - p0.y) / 6;
    const c2x = p2.x - (p3.x - p1.x) / 6;
    const c2y = p2.y - (p3.y - p1.y) / 6;
    d += ` C ${c1x.toFixed(2)} ${c1y.toFixed(2)}, ${c2x.toFixed(2)} ${c2y.toFixed(2)}, ${p2.x.toFixed(2)} ${p2.y.toFixed(2)}`;
  }
  return d;
}
