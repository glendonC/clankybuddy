// All SFX as live WebAudio compositions over audio/core primitives.
// Add a new tool → add an entry here and call sfx.<name>() from the ability.

import { beep, noise, preTransientClick } from './core.js';

export const sfx = {
  pet:   () => beep({ freq: 880, dur: 0.1, type: 'sine', vol: 0.08, sweep: 220 }),
  feed:  () => beep({ freq: 660, dur: 0.12, type: 'triangle', vol: 0.1, sweep: 200 }),
  gift:  () => { beep({ freq: 520, dur: 0.08 }); setTimeout(()=>beep({ freq: 780, dur: 0.08 }), 70); setTimeout(()=>beep({ freq: 1040, dur: 0.12 }), 140); },
  // Ascending three-note ding (used by the gift burst).
  chime: () => { beep({ freq: 1320, dur: 0.05, type: 'sine', vol: 0.08 }); setTimeout(()=>beep({ freq: 1760, dur: 0.06, type: 'sine', vol: 0.08 }), 60); setTimeout(()=>beep({ freq: 2640, dur: 0.18, type: 'sine', vol: 0.08, sweep: 200 }), 120); },
  punch: () => { beep({ freq: 180, dur: 0.07, type: 'square', vol: 0.18, sweep: -120 }); noise({ dur: 0.06, vol: 0.1 }); },
  hammer:() => { beep({ freq: 90, dur: 0.16, type: 'sawtooth', vol: 0.22, sweep: -50 }); noise({ dur: 0.18, vol: 0.18, lpFreq: 600 }); },
  bomb:  () => { beep({ freq: 60, dur: 0.4, type: 'sawtooth', vol: 0.25, sweep: -40 }); noise({ dur: 0.5, vol: 0.3, lpFreq: 800 }); },
  flame: () => noise({ dur: 0.08, vol: 0.06, lpFreq: 1800 }),
  // Electromagnet hum tick. magnet is kind:'hold' (re-fires ~every 50ms),
  // so keep it a short quiet 60Hz mains-buzz pulse + faint lowpassed hiss;
  // overlapping ticks blend into a continuous hum.
  magnet: () => { beep({ freq: 60, dur: 0.06, type: 'sawtooth', vol: 0.05 }); noise({ dur: 0.05, vol: 0.025, lpFreq: 500 }); },
  // Landmine arming/trigger CLICK (dry pressure-plate snap). The BOOM half is
  // explode()'s sound:'bomb' (above). Click-then-boom.
  landmine: () => { preTransientClick(0.45, 0); beep({ freq: 1800, dur: 0.025, type: 'square', vol: 0.07, sweep: -600 }); },
  // Buzzsaw — shrill spinning-blade whine: two slightly-detuned sawtooth voices
  // (beating "shriek") + a bright lowpassed noise band (tooth-on-metal grind).
  buzzsaw: () => {
    beep({ freq: 2200, dur: 0.22, type: 'sawtooth', vol: 0.07, sweep: 400 });
    beep({ freq: 1500, dur: 0.20, type: 'sawtooth', vol: 0.05, sweep: 300 });
    noise({ dur: 0.20, vol: 0.05, lpFreq: 3200 });
  },
  // Cryo mine DETONATION — pressurized gas hiss + icy crystallize chirp + ice crackle.
  cryoMine: () => {
    noise({ dur: 0.28, vol: 0.16, lpFreq: 5200 });
    noise({ dur: 0.12, vol: 0.08, lpFreq: 900 });
    beep({ freq: 1100, dur: 0.2, type: 'sine', vol: 0.1, sweep: -820 });
    for (let i = 0; i < 4; i++) {
      setTimeout(() => noise({ dur: 0.018, vol: 0.12, lpFreq: 7000 + (Math.random() - 0.5) * 1800 }), 30 + i * (22 + Math.random() * 18));
    }
  },
  // Cryo mine PLACEMENT — soft pressurized "set" click.
  cryoArm: () => {
    preTransientClick(0.4, 0);
    noise({ dur: 0.06, vol: 0.05, lpFreq: 2200 });
    beep({ freq: 1500, dur: 0.04, type: 'sine', vol: 0.05, sweep: 200 });
  },
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
  // Deeper, louder than the pistol — magnum boom.
  revolver: () => { beep({ freq: 140, dur: 0.1, type: 'square', vol: 0.26, sweep: -100 }); noise({ dur: 0.12, vol: 0.24, lpFreq: 1200 }); },
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
  // Dull heavy thud (brick / bowling ball landing).
  thud:    () => { beep({ freq: 110, dur: 0.14, type: 'sine', vol: 0.22, sweep: -60 }); noise({ dur: 0.12, vol: 0.16, lpFreq: 500 }); },
  // Dissonant piano crash: a clustered low chord + wood-splinter noise.
  piano:   () => {
    beep({ freq: 130, dur: 0.5, type: 'triangle', vol: 0.16, sweep: -20 });
    beep({ freq: 138, dur: 0.5, type: 'triangle', vol: 0.12 });          // detuned for the clash
    beep({ freq: 196, dur: 0.45, type: 'sine', vol: 0.10, sweep: -30 });
    noise({ dur: 0.3, vol: 0.2, lpFreq: 900 });
    beep({ freq: 70, dur: 0.3, type: 'sawtooth', vol: 0.24, sweep: -20 }); // cabinet thud
  },
  // Soft ascending two-note relief chime (first aid).
  heal:    () => { beep({ freq: 740, dur: 0.12, type: 'sine', vol: 0.08, sweep: 120 }); setTimeout(()=>beep({ freq: 1110, dur: 0.16, type: 'sine', vol: 0.07, sweep: 80 }), 90); },

  // ── Batch 3B grounded melee ─────────────────────────────────────
  // Solid wooden bat crack: sharp transient + woody mid knock + low body
  // thump. No metallic ring (blunt wood). ~120ms.
  bat: () => {
    preTransientClick(0.6, 0);
    noise({ dur: 0.03, vol: 0.16, lpFreq: 2000 });        // woody knock
    beep({ freq: 150, dur: 0.08, type: 'sine', vol: 0.18, sweep: -40 }); // body thump
  },
  // Heavy steel cleave: haft-crack transient + low body thud + metallic bite.
  // Lower/heavier and longer-tailed than the punch/hammer.
  battle_axe: () => {
    preTransientClick(0.7, 0);
    beep({ freq: 90, dur: 0.18, type: 'sawtooth', vol: 0.24, sweep: -40 }); // head thud
    noise({ dur: 0.12, vol: 0.16, lpFreq: 3200 });        // edge 'chnk' bite
  },
  // Chop + ignite-whoosh, two stacked layers: wood/steel thunk then an
  // air-rush fwoomp ~30ms later.
  fire_axe: () => {
    preTransientClick(0.6, 0);
    beep({ freq: 150, dur: 0.07, type: 'square', vol: 0.18, sweep: -60 }); // chop
    noise({ dur: 0.05, vol: 0.12, lpFreq: 3400 });        // blade bite
    setTimeout(() => {                                     // ignite whoosh
      noise({ dur: 0.22, vol: 0.12, lpFreq: 1400 });
      beep({ freq: 90, dur: 0.18, type: 'sawtooth', vol: 0.06, sweep: 40 });
    }, 30);
  },
  // Quick dry stab/slash: short bright steel 'shink' + tiny flesh-impact tick.
  // Tighter / higher-pitched than sword.
  hunting_knife: () => {
    beep({ freq: 110, dur: 0.03, type: 'square', vol: 0.1, sweep: -40 }); // impact tick
    noise({ dur: 0.06, vol: 0.14, lpFreq: 5000 });        // steel shink
  },
  // Electric prod jolt: contact snap + high crackle + fast descending zap.
  // Dry & snappy (~110ms), reads as a stun jab not a continuous arc.
  cattle_prod: () => {
    preTransientClick(0.5, 0);
    noise({ dur: 0.1, vol: 0.12, lpFreq: 6000 });          // high crackle
    beep({ freq: 1800, dur: 0.08, type: 'sawtooth', vol: 0.12, sweep: -1200 }); // zap sweep
  },
  // Continuous oxy-acetylene cutting-torch hiss. Called at most every
  // ~120ms so consecutive bursts overlap into a steady jet. Bright hiss,
  // no pitched component; modest gain (fires ~8×/sec).
  blowtorch: () => {
    noise({ dur: 0.13, vol: 0.1, lpFreq: 5000 });          // bright jet hiss
    noise({ dur: 0.1, vol: 0.04, lpFreq: 220 });           // gas-feed body rumble
  },
  // Staccato pneumatic nailer: firing-pin snap + driving 'chunk' + air-release
  // hiss. Under ~40ms total so re-fires read as a chattering nailer.
  nail_gun: () => {
    preTransientClick(0.45, 0);
    beep({ freq: 170, dur: 0.022, type: 'square', vol: 0.16, sweep: -40 }); // pneumatic chunk
    noise({ dur: 0.012, vol: 0.1, lpFreq: 7000 });         // air release
  },
  // Looping mid-high motor whirr (held drill). Retrigger throttled to ~110ms
  // so consecutive bursts blend into a continuous whirr.
  power_drill: () => {
    const j = (Math.random() - 0.5) * 30;
    beep({ freq: 320 + j, dur: 0.1, type: 'sawtooth', vol: 0.1, sweep: 30 }); // motor whirr
    noise({ dur: 0.09, vol: 0.06, lpFreq: 2600 });         // bit grind
  },
  // Metallic scatter rattle: a short burst of high dry clicks, like a handful
  // of spikes hitting the floor. Reads as clatter, not an impact thud.
  caltrops: () => {
    for (let i = 0; i < 5; i++) {
      setTimeout(() => noise({ dur: 0.015, vol: 0.14, lpFreq: 6000 + (Math.random() - 0.5) * 1500 }), i * (8 + Math.random() * 7));
    }
  },

  // ── Siege / vehicle batch ───────────────────────────────────────
  // CRT smash: glass shatter + tube implosion thud + electric crackle, layered.
  crtSmash: () => {
    preTransientClick(0.6, 0);
    beep({ freq: 3400, dur: 0.05, type: 'sine', vol: 0.13, sweep: 900 });   // high glass ping
    noise({ dur: 0.18, vol: 0.2, lpFreq: 6500 });                          // glass scatter
    beep({ freq: 70, dur: 0.16, type: 'sawtooth', vol: 0.22, sweep: -40 }); // implosion thud
    setTimeout(() => { beep({ freq: 1800, dur: 0.05, type: 'square', vol: 0.13, sweep: -1200 }); noise({ dur: 0.04, vol: 0.16, lpFreq: 8000 }); }, 6);
    setTimeout(() => noise({ dur: 0.03, vol: 0.12, lpFreq: 8000 }), 60);
    setTimeout(() => noise({ dur: 0.03, vol: 0.09, lpFreq: 8000 }), 110);
  },
  // Car crunch: sheet-metal buckle on landing — sawtooth body thud + dull
  // low-passed noise (the explode() bomb whump follows from the onImpact seam).
  carCrunch: () => {
    preTransientClick(0.4, 0);
    beep({ freq: 95, dur: 0.16, type: 'sawtooth', vol: 0.24, sweep: -50 });
    noise({ dur: 0.22, vol: 0.2, lpFreq: 900 });
    noise({ dur: 0.09, vol: 0.14, lpFreq: 2600 });
  },
  // Heavy diesel rumble bed under the slow drum (long, low-frequency).
  steamrollerRumble: () => {
    preTransientClick(0.3, 0);                                              // engine catch
    noise({ dur: 0.8, vol: 0.16, lpFreq: 180 });                           // diesel rumble bed
    beep({ freq: 60, dur: 0.7, type: 'sawtooth', vol: 0.2, sweep: -8 });   // drum weight sub
  },
  // City bus: diesel engine note + two-tone air horn (Eb4 + Bb4).
  cityBus: () => {
    noise({ dur: 0.5, vol: 0.14, lpFreq: 300 });                           // bus engine
    beep({ freq: 80, dur: 0.45, type: 'sawtooth', vol: 0.18, sweep: -10 });// engine sub
    setTimeout(() => {                                                      // air horn honk
      beep({ freq: 311, dur: 0.5, type: 'square', vol: 0.12, sweep: -6 });
      beep({ freq: 466, dur: 0.5, type: 'square', vol: 0.1, sweep: -8 });
    }, 100);
  },
  // Trebuchet counterweight creak on launch: strained rising timber.
  trebuchetCreak: () => {
    beep({ freq: 150, dur: 0.34, type: 'sawtooth', vol: 0.14, sweep: 70 });
    noise({ dur: 0.3, vol: 0.07, lpFreq: 900 });
  },
  // Trebuchet ground-shaking impact: deep sawtooth body + fat low rumble.
  trebuchetThud: () => {
    beep({ freq: 64, dur: 0.42, type: 'sawtooth', vol: 0.26, sweep: -30 });
    noise({ dur: 0.5, vol: 0.28, lpFreq: 560 });
  },
  // Office chair: metal-and-plastic clatter — frame ping + plastic thunk + caster rattle.
  officeChair: () => {
    preTransientClick(0.6, 0);
    beep({ freq: 1700, dur: 0.05, type: 'square', vol: 0.10, sweep: -700 });
    beep({ freq: 90, dur: 0.10, type: 'sawtooth', vol: 0.16, sweep: -40 });
    noise({ dur: 0.10, vol: 0.16, lpFreq: 4200 });
    setTimeout(() => noise({ dur: 0.04, vol: 0.08, lpFreq: 6000 }), 45);
  },
  // Battering ram: deep wooden boom — low sub + hollow woody knock + muffled timber crack.
  batteringRam: () => {
    preTransientClick(0.6, 0);
    beep({ freq: 70, dur: 0.32, type: 'sawtooth', vol: 0.30, sweep: -34 });
    beep({ freq: 150, dur: 0.16, type: 'triangle', vol: 0.16, sweep: -90 });
    noise({ dur: 0.30, vol: 0.20, lpFreq: 520 });
  },
};
