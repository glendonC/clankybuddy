// WebAudio primitives, AudioContext, master compressor bus, oscillator beeps,
// filtered noise, pre-transient click + punchy wrapper. Zero asset files; every
// SFX in audio/sfx.js is built by composing beep/noise calls.

let _ctx;
function ac() {
  if (!_ctx) _ctx = new (window.AudioContext || window.webkitAudioContext)();
  if (_ctx.state === 'suspended') _ctx.resume();
  return _ctx;
}

// Master bus: every voice → compressor → destination. Catches stacked SFX
// (machinegun + explosion + shatter all in one frame) without clipping.
let _master = null;
let _gain = null;
function master() {
  if (_master) return _master;
  const a = ac();
  const comp = a.createDynamicsCompressor();
  comp.threshold.value = -18;
  comp.knee.value      = 12;
  comp.ratio.value     = 6;
  comp.attack.value    = 0.003;
  comp.release.value   = 0.12;
  // Insert a master gain BEFORE the compressor so the mute toggle is hard
  // (no compressor pumping leaks at gain=0).
  _gain = a.createGain();
  _gain.gain.value = 1;
  _gain.connect(comp);
  comp.connect(a.destination);
  _master = _gain;
  return _master;
}

// Toggle hook, called from the settings store. Idempotent; safe to call
// before any audio has actually played (lazy-inits the bus).
export function setMuted(muted) {
  master();
  _gain.gain.value = muted ? 0 : 1;
}

export function beep({ freq = 440, dur = 0.08, type = 'sine', vol = 0.12, sweep = 0 }) {
  const a = ac();
  const o = a.createOscillator();
  const g = a.createGain();
  o.type = type;
  o.frequency.value = freq;
  if (sweep) o.frequency.exponentialRampToValueAtTime(Math.max(40, freq + sweep), a.currentTime + dur);
  g.gain.value = 0;
  g.gain.linearRampToValueAtTime(vol, a.currentTime + 0.005);
  g.gain.exponentialRampToValueAtTime(0.001, a.currentTime + dur);
  o.connect(g); g.connect(master());
  o.start();
  o.stop(a.currentTime + dur + 0.02);
}

export function noise({ dur = 0.15, vol = 0.15, lpFreq = 1200 }) {
  const a = ac();
  const buf = a.createBuffer(1, a.sampleRate * dur, a.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = (Math.random()*2 - 1) * (1 - i/data.length);
  const src = a.createBufferSource(); src.buffer = buf;
  const filt = a.createBiquadFilter(); filt.type = 'lowpass'; filt.frequency.value = lpFreq;
  const g = a.createGain(); g.gain.value = vol;
  src.connect(filt); filt.connect(g); g.connect(master());
  src.start();
}

// Tiny 8ms square click 4ms before a heavy hit, Agent R "+30% punchier" trick.
// Schedule by passing delaySec; otherwise plays immediately.
export function preTransientClick(volMul = 0.3, delaySec = 0) {
  const a = ac();
  const o = a.createOscillator();
  const g = a.createGain();
  o.type = 'square';
  o.frequency.value = 1000;
  const t0 = a.currentTime + delaySec;
  g.gain.setValueAtTime(0, t0);
  g.gain.linearRampToValueAtTime(0.18 * volMul, t0 + 0.001);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.008);
  o.connect(g); g.connect(master());
  o.start(t0);
  o.stop(t0 + 0.012);
}

// Convenience: play a "punchy" version of any sfx, schedule the click,
// then fire the SFX after 4ms. Use for rocket/explosion/shatter/anvil.
export function punchy(sfxFn, volMul = 0.3) {
  preTransientClick(volMul, 0);
  setTimeout(sfxFn, 4);
}
