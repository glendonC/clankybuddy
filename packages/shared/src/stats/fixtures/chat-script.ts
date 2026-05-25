// Scripted ServerEvent timeline for demo mode. The mock WS client walks
// this list and dispatches each event at its `at` offset (ms after
// connect). One-shot dramatic beats (slow_mode, redact) come from
// spec.chat.trigger*; the rest is ambient noise.

import type { ChatMessage, ServerEvent } from '../../chat.js';
import { makeRng, type Rng } from './rng.js';
import type { ScenarioSpec } from './scenarios.js';

export type ScriptedEvent = {
  at: number; // ms after connect when this fires
  event: ServerEvent;
};

const DEMO_HANDLES = [
  'sneaky-otter',
  'forklift-gpt',
  'pls-respond',
  'kernel-panic',
  'mood-curator',
  'reply-guy-7',
  'ml-cassandra',
  'tab-completer',
  'tokens-pls',
  'finite-state',
  'gpu-cowboy',
  'dot-prod',
] as const;

const DEMO_COLORS = ['red', 'green', 'yellow', 'blue', 'magenta', 'cyan'] as const;

// Ambient pretend-user chat lines (demo/mock WS): each line is blunt first-
// person. Mix = (i) narcissist self-flex, (ii) bleak confession about oneself,
// (iii) mean joke aimed at named models—not other players.

const DEMO_LINES = [
  'i am the main character and the war criminal in my own story bless me',
  'i tell myself i ration violence like a budget spiritually i do not',
  'claude types like it is paying alimony to every sentence it ever wrote',
  'my code is campfire storytelling and gpt is the only audience that claps',
  'i hurt the buddy professionally and call it therapy for me not him',
  'hammer mode summoned the prosecutor in my head buddy is the defendant',
  'llama eats scrap compute and i eat takeout we are not the same predator',

  'grok sounds like a moderator gave up mid-sentence and crowned chaos',
  'broke the buddy on purpose i blame the tool not the rot in me',
  'freeze never thaws on time the game knows i deserve static',
  'rocket spread is god telling me aim is a personality defect',
  'deepseek answers like a spreadsheet learned seduction and chose spite',
  'this build is the only pretty thing i shipped this year that is on me',

  'pet spam proves i need something small to obey my worst instincts',
  'anvil drop peaked when i lied and said lag made me evil',
  'i am rank one in my imagination and dead last on the real ladder',
  'gemini would refuse a sunrise if the policy PDF had a shadow',

  'the sycophancy button is ironic until i crave flattery from code',
  'one hand on the ship one hand on the buddy bifurcated failure state',
  'gpt carried prod weeks i carried coffee and delusion',
  'i want anonymous strangers to clap for my restraint unearned',
  'the buddy dodges on instinct i walk straight into consequences',

  'rename gemini gemini-ex inherited failure as a feature patch',
  'freeze timer lives in my skull rent free i earned the haunting',
  'everyone else climbs the board i ferment in the crawl space',
  'i flex my consistency at picking the wrong impulse every time',
  'i am my own favorite user and my own worst moderator',
] as const;

function pickHandle(rng: Rng): { handle: string; color: string } {
  return {
    handle: rng.pick(DEMO_HANDLES),
    color: rng.pick(DEMO_COLORS),
  };
}

function mkMessage(rng: Rng, ts: number, idx: number): ChatMessage {
  const { handle, color } = pickHandle(rng);
  return {
    type: 'message',
    msg_id: `demo-${idx}-${ts}`,
    handle,
    color,
    content: rng.pick(DEMO_LINES),
    timestamp: new Date(ts).toISOString(),
  };
}

export function buildSeedHistory(spec: ScenarioSpec): {
  history: ChatMessage[];
  roomCount: number;
} {
  const rng = makeRng(spec.seed).fork('chat:history');
  const now = Date.now();
  const messages: ChatMessage[] = [];
  for (let i = 0; i < spec.chat.seedHistory; i++) {
    // History stretches backward ~15 minutes; oldest first.
    const ts = now - (spec.chat.seedHistory - i) * rng.intBetween(15_000, 90_000);
    messages.push(mkMessage(rng, ts, i));
  }
  return { history: messages, roomCount: spec.chat.seedRoomCount };
}

export function buildChatScript(spec: ScenarioSpec): ScriptedEvent[] {
  const rng = makeRng(spec.seed).fork('chat:script');
  const out: ScriptedEvent[] = [];

  // Ambient messages.
  let t = spec.chat.msgEveryMs;
  let i = 1000;
  // Stop at 10 minutes, by then the user has either pivoted to stats or
  // restarted. The mock client loops the script if it does run out, but
  // 600s is plenty for a design iteration session.
  while (t < 600_000) {
    out.push({
      at: t,
      event: mkMessage(rng, Date.now() + t, i++),
    });
    t += rng.intBetween(
      Math.max(500, Math.floor(spec.chat.msgEveryMs * 0.6)),
      Math.floor(spec.chat.msgEveryMs * 1.6),
    );
  }

  // Joins and leaves.
  let jt = spec.chat.joinEveryMs;
  let roomCount = spec.chat.seedRoomCount;
  while (jt < 600_000) {
    const leaving = rng.chance(0.45);
    const { handle, color } = pickHandle(rng);
    if (leaving) {
      roomCount = Math.max(1, roomCount - 1);
      out.push({ at: jt, event: { type: 'leave', handle, roomCount } });
    } else {
      roomCount += 1;
      out.push({ at: jt, event: { type: 'join', handle, color, roomCount } });
    }
    jt += rng.intBetween(
      Math.max(1_000, Math.floor(spec.chat.joinEveryMs * 0.6)),
      Math.floor(spec.chat.joinEveryMs * 1.6),
    );
  }

  // One-shot beats.
  if (spec.chat.triggerSlowModeAtMs !== undefined) {
    const at = spec.chat.triggerSlowModeAtMs;
    out.push({
      at,
      event: {
        type: 'slow_mode',
        until: Date.now() + at + 15_000,
        interval_ms: 4_000,
      },
    });
    out.push({
      at: at + 15_000,
      event: { type: 'slow_mode', until: 0, interval_ms: 0 },
    });
  }
  if (spec.chat.triggerRedactAtMs !== undefined) {
    // Redact the first ambient message. The chat surface filters it out
    // so the user sees the line disappear in real time.
    const firstAmbient = out.find(
      (e) => e.event.type === 'message',
    );
    if (firstAmbient && firstAmbient.event.type === 'message') {
      out.push({
        at: spec.chat.triggerRedactAtMs,
        event: { type: 'redact', msg_id: firstAmbient.event.msg_id },
      });
    }
  }

  out.sort((a, b) => a.at - b.at);
  return out;
}
