// All SFX as live WebAudio compositions over audio/core primitives.
// Add a new tool → add an entry here and call sfx.<name>() from the ability.

import { beep, noise, preTransientClick } from './core.js';

export const sfx = {
  pet:   () => beep({ freq: 880, dur: 0.1, type: 'sine', vol: 0.08, sweep: 220 }),
  feed:  () => beep({ freq: 660, dur: 0.12, type: 'triangle', vol: 0.1, sweep: 200 }),
  compliment: () => { beep({ freq: 700, dur: 0.08 }); setTimeout(()=>beep({ freq: 1040, dur: 0.1 }), 80); },
  gift:  () => { beep({ freq: 520, dur: 0.08 }); setTimeout(()=>beep({ freq: 780, dur: 0.08 }), 70); setTimeout(()=>beep({ freq: 1040, dur: 0.12 }), 140); },
  gpu:   () => { beep({ freq: 1320, dur: 0.05, type: 'sine', vol: 0.08 }); setTimeout(()=>beep({ freq: 1760, dur: 0.06, type: 'sine', vol: 0.08 }), 60); setTimeout(()=>beep({ freq: 2640, dur: 0.18, type: 'sine', vol: 0.08, sweep: 200 }), 120); },
  punch: () => { beep({ freq: 180, dur: 0.07, type: 'square', vol: 0.18, sweep: -120 }); noise({ dur: 0.06, vol: 0.1 }); },
  hammer:() => { beep({ freq: 90, dur: 0.16, type: 'sawtooth', vol: 0.22, sweep: -50 }); noise({ dur: 0.18, vol: 0.18, lpFreq: 600 }); },
  bomb:  () => { beep({ freq: 60, dur: 0.4, type: 'sawtooth', vol: 0.25, sweep: -40 }); noise({ dur: 0.5, vol: 0.3, lpFreq: 800 }); },
  flame: () => noise({ dur: 0.08, vol: 0.06, lpFreq: 1800 }),
  zap:   () => {
    // 3-layer (Agent R §4): low rumble + mid crack + high sizzle.
    // Pre-transient click 4ms before the crack adds bite.
    preTransientClick(0.5, 0);
    setTimeout(() => {
      beep({ freq: 1800, dur: 0.05, type: 'square',   vol: 0.15, sweep: -1200 });
      beep({ freq: 600,  dur: 0.08, type: 'sawtooth', vol: 0.12, sweep: 600 });
    }, 4);
    // low rumble after the crack
    setTimeout(() => {
      beep({ freq: 80, dur: 0.45, type: 'sawtooth', vol: 0.18, sweep: -50 });
      noise({ dur: 0.4, vol: 0.08, lpFreq: 400 });
    }, 60);
    // high sizzle, gated 3 quick bursts
    setTimeout(() => noise({ dur: 0.03, vol: 0.18, lpFreq: 8000 }), 0);
    setTimeout(() => noise({ dur: 0.03, vol: 0.14, lpFreq: 8000 }), 50);
    setTimeout(() => noise({ dur: 0.03, vol: 0.10, lpFreq: 8000 }), 100);
  },
  gun:   () => { beep({ freq: 220, dur: 0.05, type: 'square', vol: 0.2, sweep: -160 }); noise({ dur: 0.05, vol: 0.16 }); },
  freeze:() => { beep({ freq: 900, dur: 0.18, type: 'sine', vol: 0.12, sweep: -700 }); },
  sword: () => { beep({ freq: 2200, dur: 0.06, type: 'sine', vol: 0.1, sweep: -1600 }); noise({ dur: 0.08, vol: 0.06, lpFreq: 4000 }); },
  // pitch-randomized so spray doesn't feel sample-locked
  machinegun: () => { const j = (Math.random()-.5)*40; beep({ freq: 240+j, dur: 0.04, type: 'square', vol: 0.14, sweep: -180 }); noise({ dur: 0.03, vol: 0.1 }); },
  shotgun: () => { beep({ freq: 70, dur: 0.18, type: 'sawtooth', vol: 0.26, sweep: -30 }); noise({ dur: 0.22, vol: 0.28, lpFreq: 700 }); setTimeout(()=>beep({ freq: 4200, dur: 0.03, type: 'square', vol: 0.06 }), 5); },
  rocket: () => { beep({ freq: 320, dur: 0.45, type: 'sawtooth', vol: 0.14, sweep: -160 }); noise({ dur: 0.45, vol: 0.08, lpFreq: 1400 }); },
  rocketBoom: () => { beep({ freq: 50, dur: 0.5, type: 'sawtooth', vol: 0.28, sweep: -30 }); noise({ dur: 0.6, vol: 0.32, lpFreq: 600 }); },
  fireball: () => { beep({ freq: 480, dur: 0.18, type: 'triangle', vol: 0.12, sweep: -260 }); noise({ dur: 0.18, vol: 0.08, lpFreq: 1200 }); },
  grenadeFuse: () => beep({ freq: 1400, dur: 0.04, type: 'square', vol: 0.06 }),
  anvil: () => { beep({ freq: 1100, dur: 0.5, type: 'sine', vol: 0.05, sweep: -800 }); setTimeout(()=>{ beep({ freq: 60, dur: 0.25, type: 'sawtooth', vol: 0.3, sweep: -20 }); noise({ dur: 0.25, vol: 0.22, lpFreq: 500 }); }, 480); },
  blackhole: () => { beep({ freq: 40, dur: 2.8, type: 'sine', vol: 0.18, sweep: 200 }); },
  blackholeCollapse: () => { beep({ freq: 50, dur: 0.6, type: 'sawtooth', vol: 0.3, sweep: -30 }); noise({ dur: 0.7, vol: 0.3, lpFreq: 700 }); },
  nukeSiren: () => { beep({ freq: 600, dur: 0.5, type: 'sine', vol: 0.12, sweep: 400 }); setTimeout(()=>beep({ freq: 1000, dur: 0.5, type: 'sine', vol: 0.12, sweep: -400 }), 500); setTimeout(()=>beep({ freq: 600, dur: 0.5, type: 'sine', vol: 0.12, sweep: 400 }), 1000); setTimeout(()=>beep({ freq: 1000, dur: 0.5, type: 'sine', vol: 0.12, sweep: -400 }), 1500); },
  nuke: () => { beep({ freq: 35, dur: 1.2, type: 'sawtooth', vol: 0.32, sweep: -10 }); noise({ dur: 1.4, vol: 0.34, lpFreq: 500 }); },
  shatter: () => { beep({ freq: 3200, dur: 0.05, type: 'sine', vol: 0.12, sweep: 800 }); noise({ dur: 0.16, vol: 0.18, lpFreq: 6000 }); },
  combust: () => { beep({ freq: 220, dur: 0.18, type: 'sawtooth', vol: 0.2, sweep: -140 }); noise({ dur: 0.2, vol: 0.18, lpFreq: 900 }); },
  extinguish: () => { noise({ dur: 0.35, vol: 0.1, lpFreq: 2400 }); beep({ freq: 1200, dur: 0.2, type: 'sine', vol: 0.05, sweep: -800 }); },
  grab:    () => beep({ freq: 320, dur: 0.06, type: 'square', vol: 0.06, sweep: 220 }),
  release: () => beep({ freq: 540, dur: 0.05, type: 'sine',   vol: 0.06, sweep: -280 }),
  // Phase 7, sharp crack: high-pitched whistle into a noise pop.
  whip:    () => { beep({ freq: 2400, dur: 0.04, type: 'triangle', vol: 0.10, sweep: -1800 }); noise({ dur: 0.06, vol: 0.18, lpFreq: 8000 }); },
};
