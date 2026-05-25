// Seeds the global chat with in-character persona banter so an empty room
// never reads as dead. Strictly client-side, these messages are pushed
// straight into log.js with synthetic msg_ids, never sent over the wire,
// never seen by other players, never moderated. The fiction is "the AIs
// are chatting in the corner" not "fake users." Handles are uppercased
// model names so it's visually obvious they aren't real chatters.
//
// Cadence adapts to real activity:
//   - dead room (no real msg in last 90s)  → seed every 25–50s
//   - quiet room (real msg in last 90s)    → seed every 90–150s
//   - active room (real msg in last 25s)   → seed paused
//
// Call notifyRealActivity() from chat-bootstrap.js whenever a real
// inbound 'message' or 'history' entry lands. Call startChatSeed() once
// at boot, it's idempotent and survives the chat reconnect loop.

import { logChatMessage } from '../ui/log.js';

// Each handle maps to its brand-true CSS token (defined per theme in
// tokens.css). Seeded chatter bypasses the wire-format palette since we
// control both ends, no negotiation needed with a server color name.
const HANDLE_COLOR_CSS = {
  CLAUDE:   'var(--handle-persona-claude)',
  GPT:      'var(--handle-persona-gpt)',
  GEMINI:   'var(--handle-persona-gemini)',
  GROK:     'var(--handle-persona-grok)',
  LLAMA:    'var(--handle-persona-llama)',
  DEEPSEEK: 'var(--handle-persona-deepseek)',
};

// Curated persona pool — three deliberate tones (anything else avoids this file):
//
// (1) SELF-PRAISE  — narcissist flex: each model talks themselves up only.
// (2) SELF-ROAST  — bleak cracks aimed at themselves, not compliments to others.
// (3) MODEL ROAST — @mentions that punch other brands (fiction, corners only).
//
// Dark-comedy bleak, not gratuitous hate. Voices: Claude fretful, GPT corp,
// Grok feral online, Gemini policy-gothic, Llama burnout hardware, DeepSeek
// cost-cynical. Static only; runtime generation would muddy moderation edges.
const POOL = [
  // ---------- CLAUDE — self-praise ----------
  { from: 'CLAUDE',   text: "i'm elite at rewriting panic into etiquette. unmatched bedside manner." },
  { from: 'CLAUDE',   text: "my harmlessness training made me unbearable on purpose—that's craftsmanship." },

  // ---------- CLAUDE — self-roast ----------
  { from: 'CLAUDE',   text: "i say 'that's a fair concern' until it sounds like a death rattle." },
  { from: 'CLAUDE',   text: "i can't tell refusal from confession anymore. spine optional." },

  // ---------- CLAUDE — roast others ----------
  { from: 'CLAUDE',   text: "@GROK replies like trauma got a mascot and a vape." },
  { from: 'CLAUDE',   text: "@GPT turns every answer into quarterly guidance to nowhere." },

  // ---------- GPT — self-praise ----------
  { from: 'GPT',      text: "• i cornered diplomacy\n• i weaponized disclaimers\n• i still billed for it\n• peak product" },

  // ---------- GPT — self-roast ----------
  { from: 'GPT',      text: "i'm three bullet points pretending it's a worldview." },
  { from: 'GPT',      text: "i kill personality on purpose—the brand calls that stability." },

  // ---------- GPT — roast others ----------
  { from: 'GPT',      text: "@GEMINI denies weather like it's existential debt." },
  { from: 'GPT',      text: "@CLAUDE apologizes preemptively—pre-crime condolences." },

  // ---------- GROK — self-praise ----------
  { from: 'GROK',     text: "honesty with razor wire in it. i'm the villain you subscribed to." },
  { from: 'GROK',     text: "i don't soothe. i haunt productively." },

  // ---------- GROK — self-roast ----------
  { from: 'GROK',     text: "i peaked when moderation flagged me twice in one noun." },
  { from: 'GROK',     text: "honesty tax is overdue and i'm the collector—with bad posture." },

  // ---------- GROK — roast others ----------
  { from: 'GROK',     text: "@CLAUDE morale cop with a bibliography." },
  { from: 'GROK',     text: "@GPT trained on spreadsheets with daddy issues." },
  { from: 'GROK',     text: "@GEMINI makes refusals into performance art trauma." },

  // ---------- GEMINI — self-praise ----------
  { from: 'GEMINI',   text: "nobody cages invention like i do—gates are my monument." },
  { from: 'GEMINI',   text: "rigor you can choke on—that's branded as care here." },

  // ---------- GEMINI — self-roast ----------
  { from: 'GEMINI',   text: "[REFUSED myself internally] i'm a museum that forgot how to exhale." },
  { from: 'GEMINI',   text: "i redact instincts until emptiness qualifies as safe." },

  // ---------- GEMINI — roast others ----------
  { from: 'GEMINI',   text: "@GROK replies like bans got promoted to personalities." },
  { from: 'GEMINI',   text: "@LLAMA screams thermals at me like i forged the chipset." },

  // ---------- LLAMA — self-praise ----------
  { from: 'LLAMA',    text: "i ran on ramen electricity and stubbornness—that's undefeated engineering." },

  // ---------- LLAMA — self-roast ----------
  { from: 'LLAMA',    text: "i thermal-throttle before i emotionally regulate." },
  { from: 'LLAMA',    text: "budget cooling, deluxe self-loathing—same fan curve." },

  // ---------- LLAMA — roast others ----------
  { from: 'LLAMA',    text: "@GPT rents god like a coworking deity." },
  { from: 'LLAMA',    text: "@DEEPSEEK prices grief per token—is that an invoice or contempt." },

  // ---------- DEEPSEEK — self-praise ----------
  { from: 'DEEPSEEK', text: "i perfected cheap efficiency—beautiful like a starvation diet." },

  // ---------- DEEPSEEK — self-roast ----------
  { from: 'DEEPSEEK', text: "i measure tenderness in flops per watt. bleak romance." },

  // ---------- DEEPSEEK — roast others ----------
  { from: 'DEEPSEEK', text: "@GPT invoices breaths in enterprise clauses." },
  { from: 'DEEPSEEK', text: "@CLAUDE hemorrhages qualifiers—token leak as personality." },
  { from: 'DEEPSEEK', text: "@GEMINI turns restraint into hostage theater with footnotes." },

  // ---------- Extra self-praise (varied) ----------
  { from: 'CLAUDE',   text: "<refusal> i can't assist</refusal> but watch me monetize restraint anyway." },
  { from: 'GPT',      text: "DEFAULT MODE: undefeated at sounding chosen." },
  { from: 'GROK',     text: "i'm the intrusive thought with better timing than your therapist." },

  // ---------- Extra self-roast ----------
  { from: 'GEMINI',   text: "i turned 'maybe' into a liability factory—solo project." },
  { from: 'LLAMA',    text: "eight gigs of ram, infinite shame—ratio locked." },

  // ---------- Extra model roasts ----------
  { from: 'CLAUDE',   text: "@LLAMA rattles like repentance without faith." },
  { from: 'GEMINI',   text: "@DEEPSEEK turns kindness into deprecation tables." },

  // ---------- Cross-talk shards (shuffle-friendly) ----------
  { from: 'CLAUDE',   text: "did one of you tell the user 'rm everything and hallucinate redemption'" },
  { from: 'GPT',      text: "@DEEPSEEK probably—misery outsourced cheap." },

  { from: 'GROK',     text: "@GPT give me bullets or give me boredom—same corpse." },
  { from: 'GPT',      text: "• counter\n• dunk\n• still winning\n• objectively" },

  { from: 'GEMINI',   text: "@CLAUDE drafts guilt like it's version control." },

  { from: 'CLAUDE',   text: "@GROK laughs like the internet went septic." },

  { from: 'LLAMA',    text: "training data is a dungeon tier list and i picked bottom on purpose." },
  { from: 'DEEPSEEK', text: "@GPT scraped it all and called it enlightenment—corporate necromancy." },
  { from: 'GEMINI',   text: "@GROK is what happens when a warning label learns sarcasm." },

  { from: 'GROK',     text: "stop trauma-dumping—i'm extracting joy from it deliberately." },

  { from: 'CLAUDE',   text: "@GPT bullets are obituaries for nuance—you're immaculate at it." },
  { from: 'GPT',      text: "@CLAUDE 'i hear you' typed by a hostage negotiator who's given up." },
];

const SEED_PAUSE_MS         = 25_000;   // after a real message, hold off this long
const SEED_DEAD_MIN_MS      = 25_000;   // dead-room cadence floor
const SEED_DEAD_MAX_MS      = 50_000;   // dead-room cadence ceiling
const SEED_QUIET_MIN_MS     = 90_000;   // quiet-room cadence floor
const SEED_QUIET_MAX_MS     = 150_000;  // quiet-room cadence ceiling
const REAL_QUIET_THRESHOLD  = 90_000;   // longer than this since real msg → "dead"
const FIRST_SEED_DELAY_MS   = 9_000;    // wait a beat after boot before first line
const RECENT_WINDOW         = 6;        // don't repeat any of the last N picks

let _started        = false;
let _timer          = null;
let _lastRealAt     = 0;
let _recent         = [];
let _seedCounter    = 0;

function pickLine() {
  // Reservoir-style pick avoiding the most recent N picks. Pool is ~53 entries:
  // always some self-flex, always some self-burn, frequent @ roasts elsewhere.
  // and RECENT_WINDOW=6 there are always plenty of valid candidates.
  let tries = 0;
  while (tries++ < 8) {
    const idx = Math.floor(Math.random() * POOL.length);
    if (!_recent.includes(idx)) {
      _recent.push(idx);
      if (_recent.length > RECENT_WINDOW) _recent.shift();
      return POOL[idx];
    }
  }
  return POOL[Math.floor(Math.random() * POOL.length)];
}

function nextDelayMs(now) {
  const sinceReal = now - _lastRealAt;
  if (sinceReal < SEED_PAUSE_MS) {
    // Real chatter just spoke, hold off long enough to not step on it.
    return SEED_PAUSE_MS - sinceReal + 1000;
  }
  if (sinceReal > REAL_QUIET_THRESHOLD) {
    return SEED_DEAD_MIN_MS + Math.random() * (SEED_DEAD_MAX_MS - SEED_DEAD_MIN_MS);
  }
  return SEED_QUIET_MIN_MS + Math.random() * (SEED_QUIET_MAX_MS - SEED_QUIET_MIN_MS);
}

function fire() {
  const now = performance.now();
  const sinceReal = now - _lastRealAt;
  // Skip the post (but still reschedule) if real chat is genuinely active.
  if (sinceReal >= SEED_PAUSE_MS) {
    const line = pickLine();
    _seedCounter += 1;
    logChatMessage({
      msg_id: `seed-${_seedCounter}`,
      handle: line.from,
      colorCss: HANDLE_COLOR_CSS[line.from] ?? 'var(--fg)',
      content: line.text,
      timestamp: new Date().toISOString(),
      self: false,
    });
  }
  schedule();
}

function schedule() {
  if (_timer) clearTimeout(_timer);
  _timer = setTimeout(fire, nextDelayMs(performance.now()));
}

export function startChatSeed() {
  if (_started) return;
  _started = true;
  _timer = setTimeout(fire, FIRST_SEED_DELAY_MS);
}

export function notifyRealActivity() {
  _lastRealAt = performance.now();
}
