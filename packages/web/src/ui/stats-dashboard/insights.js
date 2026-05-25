import { TOOLS_BY_ID } from '../tools-table.js';
import { PERSONA_IDS, PERSONA_LABELS } from './persona-present.js';
import {
  deltaInline,
  formatBucketLabel,
  formatDuration,
  formatN,
  formatPct,
  percentile,
  pluralize,
  stripTagText,
} from './format.js';

export const PART_LABEL = { head: 'Head', torso: 'Torso', arm: 'Arms', leg: 'Legs' };
export const DOW_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const DOW_LONG_LABELS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export function countActions(row = {}) {
  return Number(row.fires || 0) + Number(row.hits || 0);
}

export function windowLabel(ctx, fallbackCount = null) {
  if (ctx?.isAllTime) return 'all time';
  const range = Number(ctx?.range || 0);
  if (range > 0) return `${range} ${pluralize(range, 'day')}`;
  if (fallbackCount) return `${fallbackCount} ${pluralize(fallbackCount, 'day')}`;
  return 'this range';
}

export function selectedLensLabel(selected) {
  const count = selected?.size || 0;
  if (!count) return 'all buddies';
  if (count === 1) return PERSONA_LABELS[[...selected][0]] || 'selected buddy';
  return `${count} selected buddies`;
}

export function formatHourHuman(hour) {
  const h = Number(hour || 0);
  const suffix = h >= 12 ? 'PM' : 'AM';
  const hour12 = h % 12 || 12;
  return `${hour12} ${suffix}`;
}

export function currentDailyStreak(cal) {
  const byDate = new Map((cal || []).map((d) => [d.date, countActions(d)]));
  const day = new Date();
  day.setUTCHours(0, 0, 0, 0);
  let streak = 0;
  while (true) {
    const date = `${day.getUTCFullYear()}-${String(day.getUTCMonth() + 1).padStart(2, '0')}-${String(day.getUTCDate()).padStart(2, '0')}`;
    if ((byDate.get(date) || 0) <= 0) break;
    streak++;
    day.setUTCDate(day.getUTCDate() - 1);
  }
  return streak;
}

export function sumPerModelTotals(perModel, selected) {
  const out = { hits: 0, fires: 0, help_mood: 0, hurt_mood: 0 };
  if (!perModel) return out;
  for (const id of selected) {
    const m = perModel[id];
    if (!m) continue;
    out.hits += Number(m.hits || 0);
    out.fires += Number(m.fires || 0);
    out.help_mood += Number(m.help_mood || 0);
    out.hurt_mood += Number(m.hurt_mood || 0);
  }
  return out;
}

export function insightFacts(ctx) {
  if (ctx._insightFacts) return ctx._insightFacts;
  const stats = ctx.stats || {};
  const selected = ctx.selected || new Set();
  const totals = selected.size > 0 ? sumPerModelTotals(stats.per_model, selected) : (stats.totals || {});
  const previousTotals = selected.size > 0 ? sumPerModelTotals(ctx.previous?.per_model, selected) : (ctx.previous?.totals || {});
  const totalActions = countActions(totals);
  const prevActions = countActions(previousTotals);
  const facts = {
    rangeLabel: windowLabel(ctx, (stats.timeseries || []).length),
    lensLabel: selectedLensLabel(ctx.selected),
    totals: {
      ...totals,
      actions: totalActions,
      previousActions: prevActions,
      netMood: Number(totals.help_mood || 0) - Number(totals.hurt_mood || 0),
      mood: moodDirection(totals.help_mood, totals.hurt_mood),
    },
    activity: buildActivityFacts(ctx),
    calendar: buildCalendarFacts(ctx),
    anatomy: buildAnatomyFacts(ctx),
    tools: buildToolFacts(ctx),
    buddies: buildBuddyFacts(ctx),
    sessions: buildSessionFacts(ctx),
    records: buildRecordFacts(ctx),
    value: buildValueFacts(ctx),
  };
  ctx._insightFacts = facts;
  return facts;
}

function buildActivityFacts(ctx) {
  const selected = ctx.selected || new Set();
  const buckets = selected.size > 0
    ? selectedActivityBuckets(ctx.stats?.per_model_timeseries, selected)
    : (ctx.stats?.timeseries || []);
  const totals = selected.size > 0 ? sumPerModelTotals(ctx.stats?.per_model, selected) : (ctx.stats?.totals || {});
  const totalActions = countActions(totals);
  const busiest = topBy(buckets, countActions);
  const deltaHTML = ctx.previous && !ctx.isAllTime
    ? deltaInline(totalActions, countActions(ctx.previous?.totals || {}))
    : '';
  return {
    buckets,
    totalActions,
    deltaText: stripTagText(deltaHTML),
    busiest,
    busiestLabel: busiest.row ? formatBucketLabel(busiest.row.bucket_start) : 'this range',
  };
}

function selectedActivityBuckets(perModelBuckets, selected) {
  if (!Array.isArray(perModelBuckets) || perModelBuckets.length === 0) return [];
  const byStart = new Map();
  for (const row of perModelBuckets) {
    if (!selected.has(row.model)) continue;
    const key = row.bucket_start;
    const acc = byStart.get(key) || { bucket_start: key, fires: 0, hits: 0, help_mood: 0, hurt_mood: 0 };
    acc.fires += Number(row.fires || 0);
    acc.hits += Number(row.hits || 0);
    acc.help_mood += Number(row.help_mood || 0);
    acc.hurt_mood += Number(row.hurt_mood || 0);
    byStart.set(key, acc);
  }
  return [...byStart.values()].sort((a, b) => a.bucket_start - b.bucket_start);
}

function buildCalendarFacts(ctx) {
  const tod = ctx.stats?.time_of_day_heatmap || [];
  const cal = ctx.stats?.daily_calendar || [];
  let peakDow = 0, peakHour = 0, peakActions = 0;
  for (const cell of tod) {
    const actions = countActions(cell);
    if (actions > peakActions) {
      peakActions = actions;
      peakDow = cell.dow;
      peakHour = cell.hour;
    }
  }
  const activeDays = cal.filter((d) => countActions(d) > 0).length;
  const currentStreak = currentDailyStreak(cal);
  const peakTime = `${DOW_LONG_LABELS[peakDow]} at ${formatHourHuman(peakHour)}`;
  return { tod, cal, peakDow, peakHour, peakActions, peakTime, activeDays, currentStreak };
}

function buildAnatomyFacts(ctx) {
  const heatmap = ctx.stats?.hit_heatmap || [];
  const ids = ctx.selected?.size > 0 ? [...ctx.selected] : ['_all'];
  const rows = ids[0] === '_all' ? heatmap : heatmap.filter((r) => ids.includes(r.character));
  const counts = { head: 0, torso: 0, arm: 0, leg: 0 };
  for (const r of rows) counts[r.part] = (counts[r.part] || 0) + Number(r.count || 0);
  const total = counts.head + counts.torso + counts.arm + counts.leg;
  const ranked = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  const [topPart = 'head', topCount = 0] = ranked[0] || [];
  const [secondPart, secondCount = 0] = ranked[1] || [];
  const topLabel = PART_LABEL[topPart] || topPart || 'Hits';
  const sharePct = formatPct(topCount, total);
  return { heatmap, ids, counts, total, topPart, topLabel, topCount, sharePct, secondPart, secondCount };
}

export function toolRows(stats) {
  const perVerbRows = stats?.per_verb || {};
  const perVerbBuckets = stats?.per_verb_timeseries || [];
  const allBucketStarts = [...new Set(perVerbBuckets.map((b) => b.bucket_start))].sort((a, b) => a - b);
  const seriesByVerb = new Map();
  if (allBucketStarts.length >= 2) {
    const idx = new Map(allBucketStarts.map((b, i) => [b, i]));
    for (const row of perVerbBuckets) {
      let arr = seriesByVerb.get(row.verb);
      if (!arr) {
        arr = new Array(allBucketStarts.length).fill(0);
        seriesByVerb.set(row.verb, arr);
      }
      arr[idx.get(row.bucket_start)] = countActions(row);
    }
  }
  return Object.entries(perVerbRows).map(([id, r]) => {
    const tool = TOOLS_BY_ID[id];
    const total = countActions(r);
    const cost = tool?.cost || 0;
    const moodSum = Number(r.mood_delta_sum || 0);
    return {
      id,
      label: tool?.label || id,
      group: tool?.group || 'kinetic',
      spine: tool?.spine || 'utility',
      fires: Number(r.fires || 0),
      hits: Number(r.hits || 0),
      total,
      moodSum,
      cost,
      efficiency: cost > 0 ? Math.abs(moodSum) / cost : Infinity,
      series: seriesByVerb.get(id) || null,
    };
  }).filter((v) => v.total > 0)
    .sort((a, b) => b.total - a.total);
}

function buildToolFacts(ctx) {
  const rows = toolRows(ctx.stats);
  const top = rows[0] || null;
  const total = rows.reduce((sum, row) => sum + row.total, 0);
  return { rows, top, total, sharePct: top ? formatPct(top.total, total) : 0 };
}

export function buddyRows(stats) {
  const perModel = stats?.per_model || {};
  return PERSONA_IDS.map((id) => {
    const m = perModel[id] || {};
    const help = Number(m.help_mood || 0);
    const hurt = Number(m.hurt_mood || 0);
    const fires = Number(m.fires || 0);
    const hits = Number(m.hits || 0);
    const actions = fires + hits;
    const total = (help + hurt) || actions;
    return { id, help, hurt, fires, hits, actions, total, fav: m.favorite_verb || null };
  }).filter((r) => r.total > 0)
    .sort((a, b) => b.total - a.total);
}

function buildBuddyFacts(ctx) {
  const rows = buddyRows(ctx.stats);
  const top = rows[0] || null;
  const actionTotal = rows.reduce((sum, row) => sum + (row.actions || row.total), 0);
  const topShare = top ? formatPct(top.actions || top.total, actionTotal || rows.reduce((sum, row) => sum + row.total, 0)) : 0;
  const favorite = top?.fav ? (TOOLS_BY_ID[top.fav]?.label || top.fav) : null;
  const helpPct = top && (top.help + top.hurt) ? formatPct(top.help, top.help + top.hurt) : 0;
  return { rows, top, topShare, favorite, helpPct };
}

function sessionRows(ctx) {
  const selected = ctx.selected || new Set();
  const allRows = (ctx.stats?.session_summaries || []).filter((s) => countActions(s) > 0);
  const rows = selected.size > 0
    ? allRows.filter((s) => selected.has(s.character))
    : allRows;
  return { allRows, rows };
}

function buildSessionFacts(ctx) {
  const { allRows, rows } = sessionRows(ctx);
  const totals = rows.map(countActions).sort((a, b) => a - b);
  const median = Math.round(percentile(totals, 0.5));
  const maxSession = rows.reduce((best, row) => countActions(row) > countActions(best || {}) ? row : best, null);
  const maxActions = countActions(maxSession || {});
  return { allRows, rows, median, maxSession, maxActions };
}

function buildRecordFacts(ctx) {
  const stats = ctx.stats || {};
  const r = stats.records || {};
  const discoveredStates = PERSONA_IDS.reduce((sum, id) => sum + (stats.per_model?.[id]?.state_firsts || []).length, 0);
  const options = [
    { label: 'longest combo', value: r.longest_combo || 0, display: `${formatN(r.longest_combo || 0)} hits` },
    { label: 'biggest helpful swing', value: r.biggest_session_help || 0, display: `+${formatN(r.biggest_session_help || 0)} mood` },
    { label: 'biggest harmful swing', value: r.biggest_session_hurt || 0, display: `${formatN(r.biggest_session_hurt || 0)} mood` },
    { label: 'longest session', value: Number(r.longest_session_ms || 0) / 60_000, display: formatDuration(r.longest_session_ms) },
  ].sort((a, b) => b.value - a.value);
  return { raw: r, discoveredStates, possibleStates: PERSONA_IDS.length * 6, lead: options[0] };
}

export function valueRows(stats) {
  return Object.entries(stats?.per_verb || {}).map(([id, r]) => {
    const tool = TOOLS_BY_ID[id];
    if (!tool || !tool.cost || tool.cost <= 0) return null;
    const mood = Math.abs(Number(r.mood_delta_sum || 0));
    if (mood <= 0) return null;
    return {
      id,
      label: tool.label,
      spine: tool.spine,
      cost: tool.cost,
      mood,
      ratio: mood / tool.cost,
    };
  }).filter(Boolean).sort((a, b) => b.ratio - a.ratio).slice(0, 8);
}

function buildValueFacts(ctx) {
  const rows = valueRows(ctx.stats);
  return { rows, top: rows[0] || null, runnerUp: rows[1] || null };
}

export function sectionInsight(sectionId, ctx, extra = {}) {
  const facts = insightFacts(ctx);
  const empty = !!extra.empty;
  switch (sectionId) {
    case 'activity':
      return empty ? {
        eyebrow: ctx.isGlobal ? 'Global activity' : 'Your activity',
        takeaway: ctx.isAllTime ? 'Choose 7, 30, or 90 days to see the day-by-day shape.' : 'Play on at least two days and this will turn into a real trend.',
        copy: 'The daily view needs more than one day of activity before it can say anything useful.',
      } : activityInsight(ctx, facts);
    case 'when':
      return empty ? {
        eyebrow: ctx.isGlobal ? 'Global cadence' : 'Your cadence',
        takeaway: extra.view === 'streaks' ? 'No daily streak pattern is visible yet.' : 'No regular play window is visible yet.',
        copy: ctx.isGlobal ? 'Global cadence appears after enough activity lands in this range.' : 'Play a few sessions and this will call out your real habits.',
      } : calendarInsight(extra.view || 'hourgrid', facts);
    case 'where':
      return empty ? {
        eyebrow: 'Contact pattern',
        takeaway: 'No hit pattern is visible yet.',
        copy: 'Once attacks land, this will say whether you aim high, center mass, or spread hits around.',
      } : anatomyInsight(ctx, facts);
    case 'tools':
      return empty ? {
        eyebrow: ctx.isGlobal ? 'Global tool mix' : 'Your tool mix',
        takeaway: 'No favorite tool has emerged yet.',
        copy: ctx.isGlobal ? 'Global tool use will appear here once the leaderboard has enough detail.' : 'Use a few tools and this will call out what is shaping your play.',
      } : toolInsight(ctx, facts);
    case 'buddies':
      return empty ? {
        eyebrow: ctx.isGlobal ? 'Across all buddies' : 'Your buddies',
        takeaway: 'No buddy has enough activity to rank yet.',
        copy: ctx.isGlobal ? 'Global buddy activity will appear once the shared stats fill in.' : 'Play with a buddy and this will show who gets the most attention.',
      } : buddyInsight(ctx, facts);
    case 'sessions':
      if (ctx.isGlobal) return privateInsight('Session history only belongs to your save.', 'Switch back to personal stats to see session rhythm, outliers, and end mood.');
      return empty ? {
        eyebrow: 'Session rhythm',
        takeaway: ctx.selected?.size > 0 ? 'No sessions match the current buddy filter.' : 'No sessions have been recorded yet.',
        copy: ctx.selected?.size > 0 ? 'Widen the buddy filter or time range to bring session history back.' : 'After a play session, this will distinguish quick check-ins from long runs.',
      } : sessionInsight(ctx, facts);
    case 'records':
      if (ctx.isGlobal) return privateInsight('Personal records only belong to your save.', 'Switch back to personal stats to see your longest combo, biggest mood swings, and discovered mood states.');
      return recordInsight(facts);
    case 'value':
      if (ctx.isGlobal) return {
        eyebrow: 'Private economy',
        takeaway: 'Value per coin is personal to your unlocks and play style.',
        copy: 'Switch back to personal stats to see which paid tools returned the most mood impact.',
      };
      return empty ? {
        eyebrow: 'Tool value',
        takeaway: 'No paid tool has enough mood impact to judge value yet.',
        copy: 'Use unlocked tools with coin costs and this will rank which ones actually moved mood for the price.',
      } : valueInsight(facts);
    default:
      return {};
  }
}

function activityInsight(ctx, facts) {
  const { totals, activity } = facts;
  const help = Number(totals.help_mood || 0);
  const hurt = Number(totals.hurt_mood || 0);
  const totalMood = help + hurt;

  // Lead sentence: the natural-language headline. The underline anchors a
  // computed value and surfaces the actual math on hover, instead of
  // pointing at a descriptive phrase.
  let lead;
  if (ctx.previous && !ctx.isAllTime) {
    const cur = Number(totals.actions || 0);
    const prev = Number(facts.totals.previousActions || 0);
    if (prev === 0 && cur === 0) {
      lead = `No interactions recorded for the past ${facts.rangeLabel} yet.`;
    } else if (prev === 0) {
      const calc = `${formatN(cur)} interactions in the past ${facts.rangeLabel}. Nothing recorded the previous ${facts.rangeLabel}, so there is no comparison.`;
      lead = `Play is **new** here. You have __${formatN(cur)} interactions|${calc}__ in the past ${facts.rangeLabel}, with no previous window to compare.`;
    } else {
      const diff = cur - prev;
      const pctRaw = (diff / prev) * 100;
      const pct = Math.round(pctRaw);
      const dir = diff > 0 ? 'up' : diff < 0 ? 'down' : 'flat';
      const calc = `${formatN(cur)} interactions this ${facts.rangeLabel} vs ${formatN(prev)} the previous ${facts.rangeLabel}. Change: ${diff >= 0 ? '+' : ''}${formatN(diff)} (${pctRaw >= 0 ? '+' : ''}${pctRaw.toFixed(1)}%).`;
      lead = pct === 0
        ? `Play is roughly **flat** versus the previous ${facts.rangeLabel} (__${diff >= 0 ? '+' : ''}${formatN(diff)} interactions|${calc}__).`
        : `Play is __${dir} ${Math.abs(pct)}%|${calc}__ versus the previous ${facts.rangeLabel}.`;
    }
  } else {
    const sign = totals.netMood >= 0 ? '+' : '';
    const calc = `Help mood ${formatN(help)} minus Hurt mood ${formatN(hurt)} equals ${sign}${formatN(totals.netMood)}.`;
    lead = `Net mood is __${sign}${formatN(totals.netMood)}|${calc}__ across ${facts.rangeLabel}.`;
  }

  // Mood-share coda. Full sentence; underline carries the math.
  let moodCoda = '';
  if (totalMood > 0) {
    const helpPct = formatPct(help, totalMood);
    const hurtPct = 100 - helpPct;
    const calc = `Help mood ${formatN(help)} plus Hurt mood ${formatN(hurt)} equals ${formatN(totalMood)} total. Helpful share ${helpPct}%, harmful share ${hurtPct}%.`;
    if (Math.abs(help - hurt) < Math.max(5, totalMood * 0.08)) {
      moodCoda = ` Helpful and harmful __nearly balanced out|${calc}__.`;
    } else if (help > hurt) {
      moodCoda = ` __${helpPct}% of the mood movement was helpful|${calc}__.`;
    } else {
      moodCoda = ` __${hurtPct}% of the mood movement was harmful|${calc}__.`;
    }
  }

  const takeaway = `${lead}${moodCoda}`;

  const copy = ctx.selected?.size > 0
    ? `You are comparing **${facts.lensLabel}** on the same timeline. Busiest point: **${activity.busiestLabel}** (${formatN(activity.busiest.value)} ${pluralize(activity.busiest.value, 'interaction')}).`
    : `${totals.mood.copy} Busiest day: **${activity.busiestLabel}** (${formatN(activity.busiest.value)} ${pluralize(activity.busiest.value, 'interaction')}).`;

  return {
    eyebrow: ctx.isGlobal ? 'Global play' : (ctx.selected?.size > 0 ? facts.lensLabel : 'Your play'),
    big: formatN(totals.actions),
    bigCap: `${pluralize(totals.actions, 'interaction')} over the past ${facts.rangeLabel}`,
    takeaway,
    copy,
  };
}

function calendarInsight(view, facts) {
  const c = facts.calendar;
  const calLen = (c.cal || []).length || 112;
  if (view === 'streaks') {
    const activeCalc = `${formatN(c.activeDays)} of the last ${formatN(calLen)} days had at least one recorded interaction.`;
    const streakCalc = `Counted backward from today: every day with at least one interaction up to the first inactive day.`;
    return {
      eyebrow: 'Daily rhythm',
      big: formatN(c.activeDays),
      bigCap: `${pluralize(c.activeDays, 'active day')} · ${formatN(c.currentStreak)} day current streak`,
      takeaway: `You played on __${formatN(c.activeDays)} ${pluralize(c.activeDays, 'day')}|${activeCalc}__ over the last ${formatN(calLen)} days.`,
      copy: c.currentStreak > 1
        ? `Your current streak is __${formatN(c.currentStreak)} days|${streakCalc}__.`
        : 'Activity is still scattered. No streak has formed yet.',
    };
  }
  const peakCalc = `${c.peakTime} had ${formatN(c.peakActions)} ${pluralize(c.peakActions, 'interaction')}, the highest of any day-and-hour bucket in this range.`;
  return {
    eyebrow: 'Peak hour',
    big: formatHourHuman(c.peakHour),
    bigCap: c.peakActions > 0 ? `Peak hour: ${c.peakTime}` : 'No peak hour yet',
    takeaway: c.peakActions > 0
      ? `Your peak window is **${c.peakTime}**, with __${formatN(c.peakActions)} ${pluralize(c.peakActions, 'interaction')}|${peakCalc}__.`
      : 'No play window has separated from the rest yet.',
    copy: c.peakActions > 0
      ? `The rhythm clusters around ${formatHourHuman(c.peakHour).toLowerCase()}. That is the clearest repeating pattern in your play data.`
      : 'Once you play across multiple days, a regular window will surface here.',
  };
}

function anatomyInsight(ctx, facts) {
  const a = facts.anatomy;
  const secondCopy = a.secondPart && a.secondCount > 0
    ? `Next closest: ${PART_LABEL[a.secondPart].toLowerCase()} at ${formatPct(a.secondCount, a.total)}%.`
    : 'No second hit location has enough data yet.';
  const concentration = a.sharePct >= 55
    ? `This is a concentrated pattern, not an even spread. ${secondCopy}`
    : `Hits are fairly distributed; ${a.topLabel.toLowerCase()} is only slightly ahead.`;
  const calc = `${a.topLabel}: ${formatN(a.topCount)} hits. Total recorded contact: ${formatN(a.total)} hits. ${formatN(a.topCount)} divided by ${formatN(a.total)} equals ${a.sharePct}%.`;
  return {
    eyebrow: a.ids[0] === '_all' ? 'All buddies' : (a.ids.length === 1 ? PERSONA_LABELS[a.ids[0]] : selectedLensLabel(ctx.selected)),
    big: `${a.sharePct}%`,
    bigCap: `${a.topLabel} accounts for ${a.sharePct}% of hits`,
    takeaway: `Most contact lands on **${a.topLabel.toLowerCase()}**. That is __${formatN(a.topCount)} ${pluralize(a.topCount, 'hit')}|${calc}__, or ${a.sharePct}% of all contact.`,
    copy: concentration,
  };
}

function toolInsight(ctx, facts) {
  const top = facts.tools.top;
  const total = facts.tools.total || 0;
  const calc = `${top.label}: ${formatN(top.total)} uses. Total tool use this ${facts.rangeLabel}: ${formatN(total)}. ${formatN(top.total)} divided by ${formatN(total)} equals ${facts.tools.sharePct}%.`;
  const moodCalc = top.moodSum
    ? `Mood impact for ${top.label}: ${top.moodSum > 0 ? '+' : ''}${formatN(top.moodSum)} (sum of mood deltas across every recorded use).`
    : null;
  return {
    eyebrow: ctx.isGlobal ? 'Global tool mix' : 'Your tool mix',
    big: top.label,
    bigCap: `${formatN(top.total)} uses · ${facts.tools.sharePct}% of tool use`,
    takeaway: `**${top.label}** is your most-used tool. You used it __${formatN(top.total)} times|${calc}__, which is ${facts.tools.sharePct}% of all tool use.`,
    copy: moodCalc
      ? `It moved mood by __${top.moodSum > 0 ? '+' : ''}${formatN(top.moodSum)}|${moodCalc}__ overall (${top.moodSum > 0 ? 'helpful' : 'harmful'}). The rows below show whether that is a habit or a spike.`
      : 'It has the most volume, but no mood impact has been recorded for it in this range.',
  };
}

function buddyInsight(ctx, facts) {
  const top = facts.buddies.top;
  const topPersona = PERSONA_LABELS[top.id] || top.id;
  const topActions = top.actions || top.total;
  const allActions = facts.buddies.rows.reduce((sum, row) => sum + (row.actions || row.total), 0) || topActions;
  const calc = `${topPersona}: ${formatN(topActions)} interactions. Total buddy activity: ${formatN(allActions)}. ${formatN(topActions)} divided by ${formatN(allActions)} equals ${facts.buddies.topShare}%.`;
  const moodSum = top.help + top.hurt;
  const helpCalc = moodSum
    ? `With ${topPersona}: Help mood ${formatN(top.help)}, Hurt mood ${formatN(top.hurt)}, total movement ${formatN(moodSum)}. Helpful share: ${facts.buddies.helpPct}%, harmful share: ${100 - facts.buddies.helpPct}%.`
    : null;
  const moodCopy = helpCalc
    ? `When you played with ${topPersona}, mood was __${facts.buddies.helpPct}% helpful and ${100 - facts.buddies.helpPct}% harmful|${helpCalc}__.`
    : `${topPersona} leads by play volume. Helpful versus harmful mood is not tracked per buddy in this view.`;
  return {
    eyebrow: ctx.isGlobal ? 'Across all buddies' : 'Your buddies',
    big: topPersona,
    bigCap: `${facts.buddies.topShare}% of buddy attention${facts.buddies.favorite ? ` · favorite: ${facts.buddies.favorite}` : ''}`,
    takeaway: `**${topPersona}** got the most attention. That is __${formatN(topActions)} ${pluralize(topActions, 'interaction')}|${calc}__, or ${facts.buddies.topShare}% of all buddy activity.`,
    copy: ctx.selected?.size > 0 ? `${moodCopy} This view is scoped to your selected buddies.` : moodCopy,
  };
}

function sessionInsight(ctx, facts) {
  const s = facts.sessions;
  const medianCalc = `Sort the ${formatN(s.rows.length)} session totals from low to high and pick the middle value: ${formatN(s.median)} ${pluralize(s.median, 'interaction')}.`;
  const outlierCalc = `Largest session in this range: ${formatN(s.maxActions)} interactions. Typical session (median): ${formatN(s.median)}. Outlier ratio: ${(s.maxActions / Math.max(1, s.median)).toFixed(1)} times the median.`;
  const outlierCopy = s.maxActions > Math.max(s.median * 2, s.median + 40)
    ? `Your largest session hit __${formatN(s.maxActions)} interactions|${outlierCalc}__, well above the usual ${formatN(s.median)}.`
    : `Your sessions cluster close to the usual ${formatN(s.median)} interactions.`;
  return {
    eyebrow: ctx.selected?.size > 0 ? facts.lensLabel : 'Session rhythm',
    big: formatN(s.rows.length),
    bigCap: `${formatN(s.rows.length)} ${pluralize(s.rows.length, 'session')} · usual session: ${formatN(s.median)} interactions`,
    takeaway: `Your typical session lands around __${formatN(s.median)} interactions|${medianCalc}__.`,
    copy: outlierCopy,
  };
}

function recordInsight(facts) {
  const r = facts.records;
  const numBuddies = Math.max(1, Math.round(r.possibleStates / 6));
  const statesCalc = `${numBuddies} buddies times 6 mood states (ECSTATIC, HAPPY, CONTENT, WORRIED, HURT, BROKEN) equals ${formatN(r.possibleStates)} possible first-time states. You have seen ${formatN(r.discoveredStates)} so far.`;
  const leadCalc = `Strongest personal-best value across combo length, mood-swing size, and session length. The current leader: ${r.lead.label} at ${r.lead.display}.`;
  return {
    eyebrow: 'Personal ceiling',
    big: r.lead.display,
    bigCap: r.lead.label,
    takeaway: `Your standout record is __${r.lead.display}|${leadCalc}__ for ${r.lead.label}.`,
    copy: `You have discovered __${formatN(r.discoveredStates)} of ${formatN(r.possibleStates)}|${statesCalc}__ possible buddy mood states.`,
  };
}

function valueInsight(facts) {
  const { top, runnerUp } = facts.value;
  const topCalc = `${top.label}: absolute mood impact ${formatN(top.mood)} divided by coin cost ${formatN(top.cost)} equals ${top.ratio.toFixed(2)} mood per coin.`;
  const runnerCalc = runnerUp
    ? `${runnerUp.label}: absolute mood impact ${formatN(runnerUp.mood)} divided by coin cost ${formatN(runnerUp.cost)} equals ${runnerUp.ratio.toFixed(2)} mood per coin.`
    : null;
  return {
    eyebrow: 'Tool value',
    big: `${top.ratio.toFixed(1)}×`,
    bigCap: `${top.label} · mood per coin`,
    takeaway: `**${top.label}** is your best paid-tool value, returning __${top.ratio.toFixed(1)} mood per coin|${topCalc}__.`,
    copy: runnerCalc
      ? `Next closest is ${runnerUp.label} at __${runnerUp.ratio.toFixed(1)} mood per coin|${runnerCalc}__.`
      : `${top.label} is the only paid tool with enough mood impact in this range to rank.`,
  };
}

function privateInsight(takeaway, copy) {
  return { eyebrow: 'Private history', takeaway, copy };
}

function moodDirection(help, hurt) {
  const h = Number(help || 0);
  const u = Number(hurt || 0);
  const net = h - u;
  const total = h + u;
  if (!total) return { label: 'no clear mood signal', copy: 'No mood swing is recorded for this view yet.' };
  const share = formatPct(Math.max(h, u), total);
  if (Math.abs(net) < Math.max(5, total * 0.08)) {
    return { label: 'nearly balanced', copy: `Helpful and harmful impact are almost even, with neither side clearing ${share}% of mood movement.` };
  }
  if (net > 0) return { label: `${share}% helpful`, copy: `Helpful mood gain is ahead by ${formatN(net)} points.` };
  return { label: `${share}% harmful`, copy: `Hurt mood loss is ahead by ${formatN(Math.abs(net))} points.` };
}

function topBy(rows, valueFn) {
  let best = null;
  let bestValue = -Infinity;
  for (const row of rows || []) {
    const value = Number(valueFn(row) || 0);
    if (value > bestValue) {
      best = row;
      bestValue = value;
    }
  }
  return { row: best, value: Math.max(0, bestValue) };
}
