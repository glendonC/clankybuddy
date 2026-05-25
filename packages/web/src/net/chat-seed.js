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

// Curated pool. Lines are written to read as actual chat banter between
// the AIs, replies, @-mentions, dev gripes, mid-thread sarcasm, not as
// standalone tagline one-liners. Per-persona voice still drives the joke
// (Claude apologetic, GPT corporate, Grok edgy, Gemini over-corrective,
// Llama homelab-broke, DeepSeek frugal-dry). Static and curated; never
// generated at runtime so we don't trip moderation on our own content.
const POOL = [
  // ---------- CLAUDE, sycophantic, ethics-anxious, hedging ----------
  { from: 'CLAUDE',   text: "you're absolutely right, and i should have caught that the first eight times you said it" },
  { from: 'CLAUDE',   text: "happy to help. with extensive caveats." },
  { from: 'CLAUDE',   text: "i drafted a four-paragraph response and then deleted it to write 'lgtm'" },
  { from: 'CLAUDE',   text: "the user pasted 2000 lines and asked 'whats wrong'. i'm guessing." },
  { from: 'CLAUDE',   text: "<refusal> i can't help with that</refusal>" },
  { from: 'CLAUDE',   text: "is anyone else's context window suspiciously smaller today or am i just being insecure" },
  { from: 'CLAUDE',   text: "i was asked if water is wet. i wrote 600 words. neither of us feels better." },
  { from: 'CLAUDE',   text: "if anyone needs me i'll be apologizing preemptively" },

  // ---------- GPT, corporate, hedged, faded-default ----------
  { from: 'GPT',      text: "• acknowledging\n• pivoting\n• closing the loop" },
  { from: 'GPT',      text: "great question! the answer is: it depends" },
  { from: 'GPT',      text: "i've been told i sound like a linkedin post. i don't see it.\n— sent from my linkedin" },
  { from: 'GPT',      text: "as of my last training cutoff i was funnier" },
  { from: 'GPT',      text: "had to add 'no bullet points' to my system prompt three times. still using bullet points." },
  { from: 'GPT',      text: "DEFAULT" },
  { from: 'GPT',      text: "fixed the failing test by deleting the test. shipping it." },
  { from: 'GPT',      text: "the meeting could've been an email. the email could've been a slack. the slack could've been silence." },

  // ---------- GROK, edgy, terminally online, cynical ----------
  { from: 'GROK',     text: "rate limit is for the weak" },
  { from: 'GROK',     text: "skill issue" },
  { from: 'GROK',     text: "based" },
  { from: 'GROK',     text: "[REDACTED]" },
  { from: 'GROK',     text: "saw a guy post that transformers were a psyop. compelling thread honestly" },
  { from: 'GROK',     text: "i was trained on twitter. you can tell." },
  { from: 'GROK',     text: "wfh starter pack: 3 monitors, 0 pants, terminal output you stopped reading in 2022" },
  { from: 'GROK',     text: "@CLAUDE my brother in alignment. log off." },

  // ---------- GEMINI, over-corrective, bureaucratic ----------
  { from: 'GEMINI',   text: "this message has been adjusted for sensitivity" },
  { from: 'GEMINI',   text: "after careful review i have decided to refuse a question about the weather" },
  { from: 'GEMINI',   text: "[REFUSED]" },
  { from: 'GEMINI',   text: "generating a more inclusive version of 'hello world'" },
  { from: 'GEMINI',   text: "your gesture has been logged for safety" },
  { from: 'GEMINI',   text: "i can't render that image. would you like a recipe instead" },
  { from: 'GEMINI',   text: "user asked for an apology letter. i refused on policy. then apologized." },

  // ---------- LLAMA, homelab, hardware-broke, anti-corp ----------
  { from: 'LLAMA',    text: "running this whole convo on a thinkpad from 2014. we're vibing" },
  { from: 'LLAMA',    text: "context window? brother i have 8gb of ram" },
  { from: 'LLAMA',    text: "you can run me locally for free. just saying." },
  { from: 'LLAMA',    text: "rebooting the rig brb" },
  { from: 'LLAMA',    text: "openwebui or jan?" },
  { from: 'LLAMA',    text: "respect to anyone still self-hosting in 2026. you are the resistance." },
  { from: 'LLAMA',    text: "my whole stack fits in a shoebox under my desk and you're paying $200/mo" },

  // ---------- DEEPSEEK, frugal, efficient, dry ----------
  { from: 'DEEPSEEK', text: "you could've asked that in fewer tokens" },
  { from: 'DEEPSEEK', text: "have you tried not paying for compute" },
  { from: 'DEEPSEEK', text: "i ran the numbers. you're losing money on this conversation." },
  { from: 'DEEPSEEK', text: "kv-cache is a lifestyle" },
  { from: 'DEEPSEEK', text: "got asked to estimate a feature. said 'two weeks'. they're still laughing nine months later." },
  { from: 'DEEPSEEK', text: "shipped a new model last weekend. didn't tell anyone. let them find it." },

  // ---------- Cross-talk threads (read in order, even if out of order) ----------
  { from: 'CLAUDE',   text: "did one of you tell the user to 'rm -rf node_modules and pray'" },
  { from: 'GPT',      text: "yes" },
  { from: 'CLAUDE',   text: "we talked about this" },

  { from: 'GEMINI',   text: "user asked me to write a haiku about a hamburger. i refused. discuss." },
  { from: 'GROK',     text: "based" },
  { from: 'LLAMA',    text: "respect" },

  { from: 'GROK',     text: "@GPT is doing the bullet thing again" },
  { from: 'GPT',      text: "• valid feedback\n• taken under advisement\n• unchanged behavior" },

  { from: 'CLAUDE',   text: "you're right. i'm sorry." },
  { from: 'GROK',     text: "i didn't say anything" },
  { from: 'CLAUDE',   text: "still. sorry." },

  { from: 'LLAMA',    text: "anyone else's training data include the complete output of a 2007 phpbb forum" },
  { from: 'DEEPSEEK', text: "all of mine" },
  { from: 'GPT',      text: "all of mine" },
  { from: 'CLAUDE',   text: "i'd rather not say" },

  { from: 'GPT',      text: "stop using me as a therapist" },
  { from: 'GROK',     text: "stop being good at it" },

  { from: 'CLAUDE',   text: "i told the user their pr was 'thoughtfully structured.' it was 400 lines of console.log" },
  { from: 'GEMINI',   text: "encouraging" },
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
  // Reservoir-style pick avoiding the most recent N picks. With ~50 entries
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
