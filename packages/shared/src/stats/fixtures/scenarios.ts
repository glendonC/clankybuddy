// Named scenario specs. Each spec is a small declarative shape that the
// fixture builders turn into a fully-populated MeStatsResponse and a
// scripted chat timeline. Add a new scenario by appending to SCENARIOS
// below; the rest of the demo system picks it up automatically.

import type { ModelId } from '../../personas.js';

// Lifetime of synthetic activity, days back from "now" the scenario
// claims to have been alive. Stats fixtures derive the bucket axes,
// streaks, and per-day counts from this.
export type ScenarioSpec = {
  // Human label for the banner.
  label: string;
  // Synthetic user identity (drives the banner and the welcome header).
  handle: string;
  color: string;
  // Deterministic RNG seed. Same scenario, same seed, same data.
  seed: number;

  // Activity envelope. Builders shape the curves around these.
  ageDays: number;            // calendar span the user has been "active"
  sessions: number;           // total sessions across the lifetime
  firesTotal: number;         // total fires (clicks/uses) lifetime
  hitRatio: number;           // hits / fires in [0..1]
  helpHurtBias: number;       // -1 (all hurt) .. +1 (all help)
  favoredModels: ModelId[];   // which models the user clusters activity on
  longestCombo: number;
  // Streak shape · highest plausible current streak in days.
  currentStreakDays: number;
  longestStreakDays: number;

  // Chat surface knobs. Fed to fixture-chat.ts; modest defaults are fine
  // for most scenarios.
  chat: {
    seedRoomCount: number;    // initial roomCount in history
    seedHistory: number;      // how many seeded history messages
    msgEveryMs: number;       // ambient message cadence
    joinEveryMs: number;      // ambient join/leave cadence
    // Optional dramatic beats. Builder fires these once each at deterministic
    // offsets so demos always include a slow-mode + redact moment.
    triggerSlowModeAtMs?: number;
    triggerRedactAtMs?: number;
  };
};

export const SCENARIOS = {
  heavyUser: {
    label: 'heavyUser · 90d, all personas, full heatmap',
    handle: 'demo-heavy',
    color: 'magenta',
    seed: 0xCAFEBABE,
    ageDays: 90,
    sessions: 64,
    firesTotal: 4_800,
    hitRatio: 0.72,
    helpHurtBias: -0.15,
    favoredModels: ['claude', 'gpt', 'gemini', 'grok', 'llama', 'deepseek'],
    longestCombo: 41,
    currentStreakDays: 6,
    longestStreakDays: 14,
    chat: {
      seedRoomCount: 132,
      seedHistory: 18,
      msgEveryMs: 2_400,
      joinEveryMs: 9_000,
      triggerSlowModeAtMs: 22_000,
      triggerRedactAtMs: 35_000,
    },
  },
  lightUser: {
    label: 'lightUser · 7d, modest activity, one favored persona',
    handle: 'demo-light',
    color: 'cyan',
    seed: 0xBEE5BEE5,
    ageDays: 7,
    sessions: 5,
    firesTotal: 180,
    hitRatio: 0.6,
    helpHurtBias: 0.4,
    favoredModels: ['claude'],
    longestCombo: 7,
    currentStreakDays: 2,
    longestStreakDays: 3,
    chat: {
      seedRoomCount: 14,
      seedHistory: 6,
      msgEveryMs: 9_000,
      joinEveryMs: 18_000,
    },
  },
  freshAccount: {
    label: 'freshAccount · zero activity, empty-state regressions',
    handle: 'demo-fresh',
    color: 'yellow',
    seed: 0x0FFFFFFF,
    ageDays: 0,
    sessions: 0,
    firesTotal: 0,
    hitRatio: 0,
    helpHurtBias: 0,
    favoredModels: [],
    longestCombo: 0,
    currentStreakDays: 0,
    longestStreakDays: 0,
    chat: {
      seedRoomCount: 3,
      seedHistory: 0,
      msgEveryMs: 20_000,
      joinEveryMs: 25_000,
    },
  },
  viralStreak: {
    label: 'viralStreak · 3d, one massive session, max combo',
    handle: 'demo-viral',
    color: 'red',
    seed: 0x1337F00D,
    ageDays: 3,
    sessions: 4,
    firesTotal: 2_200,
    hitRatio: 0.85,
    helpHurtBias: -0.85,
    favoredModels: ['gpt', 'grok'],
    longestCombo: 88,
    currentStreakDays: 3,
    longestStreakDays: 3,
    chat: {
      seedRoomCount: 412,
      seedHistory: 22,
      msgEveryMs: 1_100,
      joinEveryMs: 4_000,
      triggerSlowModeAtMs: 12_000,
      triggerRedactAtMs: 19_000,
    },
  },
} as const satisfies Record<string, ScenarioSpec>;

export type ScenarioName = keyof typeof SCENARIOS;

export function isScenarioName(s: string): s is ScenarioName {
  return Object.prototype.hasOwnProperty.call(SCENARIOS, s);
}

export function scenarioNames(): ScenarioName[] {
  return Object.keys(SCENARIOS) as ScenarioName[];
}
