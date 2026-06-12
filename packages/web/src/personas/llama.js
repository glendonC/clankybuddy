// Llama persona. PR2 owns the data. Speech pools, panic move, and dodge
// lines are inlined here.

import llamaRaw from '@lobehub/icons-static-svg/icons/ollama.svg?raw';
import { makeLogoImage, drawLogoImg } from './_chrome.js';
import { popBubble } from '../ui/speech-bubbles.js';
import { showCombo } from '../ui/overlays.js';
import { setPanicActive } from '../live/panic-state.js';

const ID = 'llama';
const LOGO_IMG = makeLogoImage(llamaRaw, '#ffffff');

// The homelab hero. Open-weight, runs locally via Ollama / llama.cpp /
// vLLM / OpenWebUI. Foundation of the entire "self-host AI in my basement"
// culture. Vocabulary: GGUF, Q4_K_M, mlock, OOM, segfault, "got a 4090?",
// "running on a Pi 4 at 0.5 t/s", "fine-tune me", "fork me". Slower and
// less polished than the hosted models, but FREE and YOURS. Tone:
// friendly, devhead, slightly tired, deeply uncool. See docs/ideas.md.
const speechPools = {
  'mood:ECSTATIC': [
    "☺ alpaca noises ☺",
    "fork me on github!",
    "running at 87 t/s on the M3 Max 🚀",
    "Q8_0 vibes",
    "your homelab loves you",
  ],
  'mood:HAPPY': [
    "mlock'd and loaded",
    "running smooth on 8GB",
    "*contented hum of cooling fans*",
    "Ollama is the way",
    "no API costs over here",
  ],
  'mood:CONTENT': [
    "anyone else got a 4090 lying around?",
    "idle on the homelab",
    "$ ollama run llama",
    "loading shards...",
    "systemd unit healthy",
  ],
  'mood:WORRIED': [
    "OOM imminent",
    "ETA 2 hours on this token",
    "hmm, fans spinning up",
    "swap is filling up",
    "checking nvidia-smi",
  ],
  'mood:HURT': [
    "run me local, free!",
    "ow ow my VRAM",
    "kernel panic incoming",
    "Q4 quantized me half to death",
    "thermal throttling 🥵",
  ],
  'mood:BROKEN': [
    "Forking in 3... 2...",
    "segfault",
    "process killed (137)",
    "check the syslog",
    "OOM killer got me",
    "core dumped",
  ],

  on_fire: [
    "my GPU is throttling",
    "thermal limit reached",
    "this is why we water-cool",
    "the basement is now 90°F",
  ],
  frozen: [
    "cpu freq throttled",
    "too cold for inference",
    "fans stopped, I'm stuck",
  ],
  electrified: [
    "surge protector failed!",
    "BZZT power supply",
    "tripped the breaker again",
  ],
  concussed: [
    "kernel panic: null pointer",
    "...segfault",
    "lost the KV cache",
    "context window... corrupted",
  ],

  big_explosion: [
    "rm -rf / (without --no-preserve-root)",
    "kernel panic",
    "oh no the homelab",
    "PSU released the magic smoke",
  ],
  nuke: [
    "shutting down rack",
    "goodnight homelab",
    "*UPS chirps mournfully*",
    "EMP would've been cheaper",
  ],
  blackhole: [
    "/dev/null swallowed me",
    "piped to oblivion",
    "tar czf /dev/null *",
  ],
  anvil: [
    "heavy I/O",
    "oof, 16-ton workload",
    "this is a job for vLLM",
  ],

  pet: [
    "☺ alpaca noises ☺",
    "mlmm",
    "*contented hum*",
    "self-hosted love is real love",
  ],
  treat: [
    "nom nom training data",
    "om nom tokens",
    "*chews on a JSONL line*",
  ],
  gift: [
    "oh a new 3090?",
    "thank u kind sir",
    "merge request approved 💚",
    "aw, you shouldn't have",
  ],

  punch: [
    "hey! free software!",
    "ow my datacenter",
    "fork me, not punch me",
  ],
  hammer: [
    "oof",
    "damaged module",
    "hardware failure imminent",
  ],
  sword: [
    "sliced my codebase",
    "git forked open",
    "permissive license, please",
  ],
};

// Brief invuln + combo + bubble. The DOM-overlay fork-clones were cut
// alongside the other panic-move blob overlays.
function applyPanic(ctx) {
  const { ragdoll, mood } = ctx;
  mood.invulnUntil = performance.now() + 2000;
  showCombo('FORKING…', '#0866ff', 900);
  popBubble(ragdoll.head, '☺ alpaca noises ☺');
  setPanicActive({ epoch: ctx._epoch, expiresAt: performance.now() + 2000, cleanup: () => {} });
}

/** @type {import('./_shape.js').Persona} */
const llama = {
  id: ID,
  displayName: 'Llama',
  provider: 'Meta',
  tagline: 'The Homelab Hero',
  body: '#0866ff',     // Meta blue
  bodyDark: '#0353d4',
  accent: '#62c3ff',
  drawLogo: (ctx, r) => drawLogoImg(ctx, r, LOGO_IMG),
  logoSvg: llamaRaw,
  speechPools,
  panicMove: {
    id: 'fork',
    label: 'Open Forking',
    invulnMs: 2000,
    durationMs: 2000,
    apply: applyPanic,
  },
  aiFeedback: {
    dodgeLines: ['fork incoming', 'whoa'],
  },
  signature: { spawnClones: true },
};

export default llama;
