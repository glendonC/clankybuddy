import { TOOLS } from '../tools-table.js';
import { PERSONA_IDS } from './persona-present.js';

function mulberry32(seed) {
  let t = seed >>> 0;
  return () => {
    t = (t + 0x6D2B79F5) >>> 0;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

export function buildDemoStats({ since, until, granularity = 'day', seedShift = 0 } = {}) {
  const rng = mulberry32(0x91827364 + seedShift * 0xDEAD);
  const stepMs = granularity === 'hour' ? 60 * 60_000 : 24 * 60 * 60_000;
  const buckets = Math.max(2, Math.round((until - since) / stepMs));
  const mul = seedShift ? 0.62 : 1;

  let level = 18 + rng() * 22;
  const timeseries = [];
  let totalFires = 0, totalHits = 0, totalHelp = 0, totalHurt = 0;
  for (let i = 0; i < buckets; i++) {
    level += (rng() - 0.5) * 6;
    if (i % Math.max(3, Math.floor(buckets / 6)) === 0) level += rng() * 14;
    level = Math.max(2, level);
    const fires = Math.round(level * mul);
    const hits = Math.round(fires * (0.55 + rng() * 0.25));
    const help = Math.round(fires * (0.16 + rng() * 0.08) * (rng() > 0.4 ? 1 : 0));
    const hurt = Math.round(fires * (0.32 + rng() * 0.22));
    timeseries.push({
      bucket_start: since + i * stepMs,
      fires, hits, help_mood: help, hurt_mood: hurt,
      sessions: 0, play_ms: Math.round(fires * 90_000 * mul),
    });
    totalFires += fires;
    totalHits += hits;
    totalHelp += help;
    totalHurt += hurt;
  }

  const personaIds = [...PERSONA_IDS];
  const weights = personaIds.map(() => 0.25 + rng() * 1.5);
  const wSum = weights.reduce((a, b) => a + b, 0);
  const per_model = {};
  for (let i = 0; i < personaIds.length; i++) {
    const share = weights[i] / wSum;
    const mFires = Math.round(totalFires * share);
    const mHits = Math.round(totalHits * share);
    const mHelp = Math.round(totalHelp * share);
    const mHurt = Math.round(totalHurt * share);
    if (mFires + mHits === 0) continue;
    per_model[personaIds[i]] = {
      fires: mFires, hits: mHits, help_mood: mHelp, hurt_mood: mHurt,
      favorite_verb: TOOLS[Math.floor(rng() * TOOLS.length)].id,
      state_firsts: rng() > 0.4 ? ['HAPPY', 'HURT'] : [],
    };
  }

  const sampleSize = Math.min(8, TOOLS.length);
  const sample = [...TOOLS].sort(() => rng() - 0.5).slice(0, sampleSize);
  const per_verb = {};
  let remF = totalFires, remH = totalHits, remM = (totalHelp - totalHurt);
  for (let i = 0; i < sample.length; i++) {
    const last = i === sample.length - 1;
    const f = last ? remF : Math.round(remF * (0.18 + rng() * 0.32));
    const h = last ? remH : Math.round(remH * (0.18 + rng() * 0.32));
    const m = last ? remM : Math.round(remM * (0.18 + rng() * 0.32));
    remF -= f; remH -= h; remM -= m;
    per_verb[sample[i].id] = {
      fires: Math.max(0, f),
      hits: Math.max(0, h),
      mood_delta_sum: m,
      per_model: {},
    };
  }

  const per_verb_timeseries = [];
  for (const [verbId, r] of Object.entries(per_verb)) {
    if ((r.fires + r.hits) <= 0) continue;
    let lev = 1 + rng() * 4;
    let acc = 0;
    const counts = [];
    for (let i = 0; i < buckets; i++) {
      lev += (rng() - 0.5) * 1.6;
      lev = Math.max(0.2, lev);
      counts.push(lev);
      acc += lev;
    }
    const scale = (r.fires + r.hits) / acc;
    counts.forEach((c, i) => {
      const total = Math.max(0, Math.round(c * scale));
      if (total <= 0) return;
      const fires = Math.round(total * 0.5);
      per_verb_timeseries.push({
        bucket_start: since + i * stepMs,
        verb: verbId,
        fires,
        hits: total - fires,
        mood_delta: 0,
      });
    });
  }

  const per_model_timeseries = [];
  for (const [mId, m] of Object.entries(per_model)) {
    const total = m.fires + m.hits;
    if (total <= 0) continue;
    const share = total / (totalFires + totalHits || 1);
    timeseries.forEach((b) => {
      const f = Math.round((b.fires || 0) * share);
      const h = Math.round((b.hits || 0) * share);
      if (f + h === 0) return;
      per_model_timeseries.push({
        bucket_start: b.bucket_start,
        model: mId,
        fires: f, hits: h,
        help_mood: Math.round((b.help_mood || 0) * share),
        hurt_mood: Math.round((b.hurt_mood || 0) * share),
      });
    });
  }

  const time_of_day_heatmap = [];
  for (let dow = 0; dow < 7; dow++) {
    for (let hour = 0; hour < 24; hour++) {
      const eveningBoost = hour >= 19 && hour <= 23 ? 1.4 : 1.0;
      const weekendBoost = (dow === 0 || dow === 6) ? 1.2 : 1.0;
      const dayPenalty = hour >= 2 && hour <= 7 ? 0.05 : 1.0;
      const noise = 0.4 + rng() * 0.8;
      const v = Math.round((totalFires / 168) * eveningBoost * weekendBoost * dayPenalty * noise);
      if (v > 0) time_of_day_heatmap.push({ dow, hour, fires: v, hits: Math.round(v * 0.5) });
    }
  }

  const daily_calendar = [];
  const days = Math.max(1, Math.round((until - since) / 86_400_000));
  for (let i = 0; i < days; i++) {
    const d = new Date(since + i * 86_400_000);
    const dateStr = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
    if (rng() < 0.18) continue;
    const fires = Math.round(8 + rng() * 50);
    daily_calendar.push({
      date: dateStr,
      fires,
      hits: Math.round(fires * 0.55),
      sessions: rng() < 0.7 ? 1 : 2,
      play_ms: Math.round(fires * 90_000),
    });
  }

  const sessions = Math.max(2, Math.round(days * 0.7));
  const session_summaries = [];
  const states = ['ECSTATIC', 'HAPPY', 'CONTENT', 'WORRIED', 'HURT', 'BROKEN'];
  for (let i = 0; i < sessions; i++) {
    const startOffset = rng() * (until - since);
    const startedAt = since + startOffset;
    const dur = (4 + rng() * 22) * 60_000;
    const fires = Math.round(20 + rng() * 220);
    const hits = Math.round(fires * (0.4 + rng() * 0.4));
    const help = Math.round(fires * 0.18 * (rng() > 0.5 ? 1 : 0.2));
    const hurt = Math.round(fires * 0.4 * rng());
    session_summaries.push({
      session_id: `demo-${i}`,
      started_at: startedAt,
      ended_at: startedAt + dur,
      duration_ms: dur,
      character: personaIds[Math.floor(rng() * personaIds.length)],
      fires, hits, help_mood: help, hurt_mood: hurt,
      peak_mood: Math.round(rng() * 100),
      trough_mood: Math.round(-rng() * 100),
      end_state: states[Math.floor(rng() * states.length)],
      longest_combo: Math.round(rng() * 8),
    });
  }

  const heatBase = Math.max(8, Math.round(totalHits * 0.42));
  const partTotals = {
    torso: heatBase + Math.round(rng() * 14),
    head: Math.round(heatBase * 0.62 + rng() * 10),
    arm: Math.round(heatBase * 0.48 + rng() * 8),
    leg: Math.round(heatBase * 0.30 + rng() * 6),
  };
  const hit_heatmap = [];
  const populated = Object.entries(per_model).filter(([, m]) => (m.hits || 0) > 0);
  const hitsSum = populated.reduce((s, [, m]) => s + (m.hits || 0), 0) || 1;
  for (const [part, partTotal] of Object.entries(partTotals)) {
    let assigned = 0;
    populated.forEach(([id, m], i) => {
      const isLast = i === populated.length - 1;
      const share = isLast ? partTotal - assigned : Math.round(partTotal * (m.hits / hitsSum));
      assigned += share;
      if (share > 0) hit_heatmap.push({ character: id, part, count: share });
    });
  }

  return {
    window: { since: new Date(since).toISOString(), until: new Date(until).toISOString(), granularity },
    totals: {
      sessions,
      play_ms: Math.round(sessions * (4 + rng() * 22) * 60_000),
      fires: totalFires,
      hits: totalHits,
      help_mood: totalHelp,
      hurt_mood: totalHurt,
    },
    records: {
      longest_combo: 12 + Math.floor(rng() * 38),
      biggest_session_hurt: Math.round(totalHurt * 0.22),
      biggest_session_help: Math.round(totalHelp * 0.28),
      longest_session_ms: (10 + Math.floor(rng() * 24)) * 60_000,
    },
    per_model,
    per_verb,
    timeseries,
    per_verb_timeseries,
    per_model_timeseries,
    time_of_day_heatmap,
    daily_calendar,
    session_summaries,
    hit_heatmap,
    combo_log: [],
  };
}

export function buildDemoAllTimeStats() {
  const monthly = buildDemoStats({
    since: Date.now() - 30 * 86_400_000,
    until: Date.now(),
    granularity: 'day',
    seedShift: 7,
  });
  const scale = 11;
  const mul = (n) => Math.round((n || 0) * scale);
  const per_model = {};
  for (const [id, m] of Object.entries(monthly.per_model || {})) {
    per_model[id] = {
      ...m,
      fires: mul(m.fires),
      hits: mul(m.hits),
      help_mood: 0,
      hurt_mood: 0,
    };
  }
  const per_verb = {};
  for (const [id, v] of Object.entries(monthly.per_verb || {})) {
    per_verb[id] = {
      fires: mul(v.fires),
      hits: 0,
      mood_delta_sum: 0,
      per_model: {},
    };
  }
  const totalFires = Object.values(per_model).reduce((s, m) => s + m.fires, 0);
  const totalHits = Object.values(per_model).reduce((s, m) => s + m.hits, 0);
  return {
    ...monthly,
    window: { since: new Date(0).toISOString(), until: new Date().toISOString(), granularity: 'all' },
    totals: {
      sessions: 0,
      play_ms: 0,
      fires: totalFires,
      hits: totalHits,
      help_mood: 0,
      hurt_mood: 0,
    },
    timeseries: [],
    records: { longest_combo: 0, biggest_session_help: 0, biggest_session_hurt: 0, longest_session_ms: 0 },
    per_model,
    per_verb,
    per_verb_timeseries: [],
    per_model_timeseries: [],
    daily_calendar: monthly.daily_calendar,
    time_of_day_heatmap: monthly.time_of_day_heatmap,
    session_summaries: [],
    hit_heatmap: (monthly.hit_heatmap || []).map((r) => ({ ...r, count: mul(r.count) })),
  };
}

export function buildDemoGlobalStats() {
  const monthly = buildDemoStats({
    since: Date.now() - 30 * 86_400_000,
    until: Date.now(),
    granularity: 'day',
    seedShift: 11,
  });
  const scale = 4500;
  const per_model = {};
  let help = 0, hurt = 0;
  for (const id of PERSONA_IDS) {
    const base = (monthly.per_model[id]?.fires || 60) * scale;
    const h = Math.round(base * (0.42 + Math.random() * 0.18));
    const u = Math.round(base * (0.4 + Math.random() * 0.2));
    per_model[id] = {
      fires: h + u, hits: 0,
      help_mood: h, hurt_mood: u,
      favorite_verb: null, state_firsts: [],
    };
    help += h; hurt += u;
  }
  return {
    window: { since: null, until: null, granularity: 'all' },
    totals: {
      sessions: 0,
      play_ms: 0,
      fires: help + hurt,
      hits: 0,
      help_mood: help,
      hurt_mood: hurt,
    },
    records: {},
    per_model,
    per_verb: {},
    timeseries: monthly.timeseries,
    per_verb_timeseries: [],
    per_model_timeseries: monthly.per_model_timeseries,
    time_of_day_heatmap: monthly.time_of_day_heatmap,
    daily_calendar: [],
    session_summaries: [],
    hit_heatmap: [],
    combo_log: [],
  };
}
