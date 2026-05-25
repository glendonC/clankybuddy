import { cloudflareTest } from '@cloudflare/vitest-pool-workers';
import { defineConfig } from 'vitest/config';

// Phase A smoke harness, Miniflare drives the worker exactly the way prod
// does. The pool spins up a single isolate per test file, instantiates DOs +
// KV from wrangler.test.toml, and routes `SELF.fetch(...)` through the same
// `export default { fetch }` we ship.
//
// Goal here is INFRA, not coverage: one passing request proves the harness
// works so Phase B can layer real auth/route tests on top without rebuilding
// the wiring.
//
// vitest-pool-workers v0.15+ ships its config helper as a Vite plugin
// (`cloudflareTest`) registered in `plugins: []`, replacing the older
// `defineWorkersConfig` / `poolOptions.workers` shape. See the migration
// codemod in `@cloudflare/vitest-pool-workers/codemods/vitest-v3-to-v4`.
//
// We point at wrangler.test.toml (not wrangler.toml) so [ai] +
// [[analytics_engine_datasets]], both of which require remote CF
// connectivity to boot, are excluded. The smoke test doesn't touch them;
// Phase B can introduce a separate vitest project for AI-binding tests if
// needed.
export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: './wrangler.test.toml' },
    }),
  ],
});
