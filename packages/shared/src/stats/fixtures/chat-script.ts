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

const DEMO_LINES = [
  'is claude down again?',
  'tried to convince gemini it was 1997. it agreed.',
  'i love this little guy',
  'punched gpt 40 times today, feeling better',
  'who else codes with hammer mode on',
  'someone get llama a snack',
  'grok says \'lol\' way too much',
  'finally hit BROKEN state, achievement unlocked',
  'why does freeze never melt on time',
  'rocket launcher tutorial when',
  'deepseek mood meter is BUGGED i swear',
  'this is the best fidget app on the internet',
  'pet pet pet pet pet pet',
  'anvil drop never gets old',
  'wholesome compliment chain in 3, 2, 1...',
  'GG everyone, going for the high score',
  'who taught the buddy to dodge',
  'we should rename gemini to gemini-x',
  'sycophancy hits different',
  'just shipped a feature with one hand, petting buddy with the other',
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
