// Demo-mode entry point. Boot-time singleton, call initDemo() once from
// cli.tsx before anything else, then everywhere downstream just asks
// isDemoMode() / getScenarioSpec().
//
// Toggle precedence:
//   --demo=<name> > --demo > CLANKYBUDDY_DEMO=1 (+ CLANKYBUDDY_DEMO_SCENARIO)
//
// Unknown scenario names fail-fast with the list of valid names; no
// silent fallback. Demo mode is a CLI-only construct · the worker has no
// awareness of it.

import { AGE_GATE_VERSION } from '../../../shared/src/age-gate.js';
import type { Config } from '../config.js';
import {
  SCENARIOS,
  isScenarioName,
  scenarioNames,
  type ScenarioName,
  type ScenarioSpec,
} from '../../../shared/src/stats/fixtures/index.js';

const DEFAULT_SCENARIO: ScenarioName = 'heavyUser';

type DemoState = {
  scenario: ScenarioName;
  spec: ScenarioSpec;
};

let cached: DemoState | null = null;
let initialized = false;

// Strip a `--demo` form out of argv and return the requested scenario
// name (or DEFAULT_SCENARIO for bare `--demo`). Returns null when no
// `--demo` form is present. Accepts:
//   --demo
//   --demo=<name>
//   --demo <name>
function pickFromArgv(argv: readonly string[]): string | null {
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === '--demo') {
      const next = argv[i + 1];
      if (next && !next.startsWith('-')) return next;
      return DEFAULT_SCENARIO;
    }
    if (a.startsWith('--demo=')) {
      const v = a.slice('--demo='.length);
      return v === '' ? DEFAULT_SCENARIO : v;
    }
  }
  return null;
}

function pickFromEnv(): string | null {
  const flag = process.env.CLANKYBUDDY_DEMO;
  if (flag !== '1' && flag !== 'true') return null;
  const named = process.env.CLANKYBUDDY_DEMO_SCENARIO;
  if (named && named.length > 0) return named;
  return DEFAULT_SCENARIO;
}

export function initDemo(argv: readonly string[] = process.argv.slice(2)): void {
  if (initialized) return;
  initialized = true;
  const requested = pickFromArgv(argv) ?? pickFromEnv();
  if (!requested) return;
  if (!isScenarioName(requested)) {
    const valid = scenarioNames().join(', ');
    process.stderr.write(
      `clankybuddy: unknown demo scenario "${requested}". Valid: ${valid}\n`,
    );
    process.exit(2);
  }
  cached = { scenario: requested, spec: SCENARIOS[requested] };
}

export function isDemoMode(): boolean {
  return cached !== null;
}

export function getScenarioName(): ScenarioName | null {
  return cached?.scenario ?? null;
}

export function getScenarioSpec(): ScenarioSpec {
  if (!cached) {
    throw new Error('getScenarioSpec() called outside demo mode');
  }
  return cached.spec;
}

// Synthetic Config used in lieu of disk-read auth. Skips authInit
// entirely so demo mode works offline / without a verified account.
export function getDemoConfig(): Config {
  if (!cached) {
    throw new Error('getDemoConfig() called outside demo mode');
  }
  const spec = cached.spec;
  return {
    version: 3,
    access_token: 'demo-access-token',
    access_token_issued_at: Date.now(),
    refresh_token: 'demo-refresh-token',
    user_id: `demo-${cached.scenario}`,
    handle: spec.handle,
    color: spec.color,
    api_base: 'https://demo.clankybuddy.invalid',
    age_gate: { confirmed_at: Date.now(), version: AGE_GATE_VERSION },
  };
}
