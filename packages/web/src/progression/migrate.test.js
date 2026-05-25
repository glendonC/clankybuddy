// Save migration test. There is no test runner wired up for the web client
// at the time this lands, adding one (vitest is the obvious pick; it
// shares Vite's TS + .js-extension resolution) is a separate infra PR.
// This file is shape-compatible with vitest / jest / mocha:
//
//   npx vitest run src/progression/migrate.test.js
//
// Plain `node` will NOT run it directly, the registry imports a .ts file
// from packages/shared via a .js extension (the project-wide pattern that
// Vite resolves), and node's ESM loader can't transpile that hop.
//
// What this test pins down:
//   1. v4 → v6: currency stays global; group-tree node ids land in EVERY
//      character's unlockedNodes (after Phase-1 group rename); master-tree
//      ids land in unlockedNodesGlobal.
//   2. seenStates keyed by charId in v4 reshape into per-char slices,
//      unknown char keys drop.
//   3. Cross-version chain: a v1 save migrates all the way to v6 in one go.
//   4. v6 envelope has clientId + updatedAt for backup-on-server.
//   5. v5 → v6 group-id rewrite: `g.melee.*` → `g.kinetic.*` etc.,
//      including the `g.elemental.freeze` → `g.manipulation.freeze`
//      pre-rewrite carve-out so the freeze legacy rename doesn't get
//      swept into corruption by the prefix substitution.

import assert from 'node:assert/strict';

import { migrate, SAVE_VERSION, makeFreshV5 } from './migrate.js';
import { PERSONA_IDS } from '@clankybuddy/shared/personas';
import { FREE_STARTER_NODE_IDS } from './groups/index.js';

const DEFAULTS = ['pet', 'feed', 'punch', 'grab'];

function emptyBars() {
  return Array.from({ length: 10 }, () => Array(12).fill(null));
}

// 1. v4 → v6: per-character clone + global currency + Phase-1 rename.
{
  const v4 = {
    version: 4,
    currency: 1234,
    unlockedTools: ['pet', 'feed', 'punch', 'grab', 'hammer'],
    unlockedNodes: ['g.melee.hammer', 'master.shake1'],
    equippedBars: emptyBars(),
    visibleBars: [true, false, false, false, false, false, false, false, false, false],
    seenStates: { claude: { HAPPY: true }, gpt: { ECSTATIC: true }, gone_persona: { OOPS: true } },
    lifetimeEarned: 5000,
    lifetimeSpent: 800,
  };
  const out = migrate(v4, DEFAULTS);
  assert.equal(out.version, SAVE_VERSION);
  assert.equal(out.currency, 1234, 'currency stays global');
  assert.equal(out.lifetimeEarned, 5000);
  assert.equal(out.lifetimeSpent, 800);
  assert.deepEqual(out.unlockedNodesGlobal, ['master.shake1'], 'master nodes go global');
  for (const charId of PERSONA_IDS) {
    const c = out.byCharacter[charId];
    assert.ok(c, `slice exists for ${charId}`);
    assert.deepEqual(c.unlockedTools, ['pet', 'feed', 'punch', 'grab', 'hammer']);
    assert.deepEqual(c.unlockedNodes, ['g.kinetic.hammer'],
      'group nodes per-char, prefix rewritten by v5→v6');
  }
  assert.deepEqual(out.byCharacter.claude.seenStates, { HAPPY: true });
  assert.deepEqual(out.byCharacter.gpt.seenStates,    { ECSTATIC: true });
  assert.equal(out.byCharacter.gemini?.seenStates ? Object.keys(out.byCharacter.gemini.seenStates).length : 0, 0,
    'untouched chars start with empty seenStates');
  assert.ok(typeof out.clientId === 'string' && out.clientId.length > 0, 'clientId envelope present');
  assert.ok(typeof out.updatedAt === 'number', 'updatedAt envelope present');
  // No 'gone_persona' leak.
  assert.equal(out.byCharacter.gone_persona, undefined);
  console.log('OK v4 → v6: currency global, per-char clones, master nodes lifted, kinetic rename');
}

// 2. v1 → current cascade.
{
  const v1 = {
    version: 1,
    currency: 42,
    unlockedTools: ['pet'],
    seenStates: {},
    lifetimeEarned: 100,
  };
  const out = migrate(v1, DEFAULTS);
  assert.equal(out.version, SAVE_VERSION);
  assert.equal(out.currency, 42);
  for (const charId of PERSONA_IDS) {
    const c = out.byCharacter[charId];
    // Defaults seeded.
    for (const t of DEFAULTS) assert.ok(c.unlockedTools.includes(t), `${charId} got ${t}`);
  }
  console.log('OK v1 → current cascade');
}

// 5. v5 → v6 group-id rewrite, including freeze pre-rewrite carve-out.
{
  const v5 = {
    version: 5,
    currency: 0,
    lifetimeEarned: 0,
    lifetimeSpent: 0,
    unlockedNodesGlobal: ['master.shake1'],
    flags: {},
    byCharacter: {
      claude: {
        unlockedTools: ['pet', 'feed', 'punch', 'grab', 'hammer', 'rocket', 'fireball'],
        unlockedNodes: [
          'g.melee.hammer',
          'g.ranged.rocket.warhead',
          'g.elemental.fireball',
          // Carve-outs: freeze and lightning have non-default targets
          // that the prefix rewrite would otherwise miss.
          'g.elemental.freeze',
          'g.elemental.freeze.duration',
          'g.elemental.lightning',
          'g.elemental.lightning.zeus',
          'g.gifts.gift',
          'g.blessings.gpu',
          'g.god.anvil',
        ],
        equippedBars: emptyBars(),
        visibleBars: [true, false, false, false, false, false, false, false, false, false],
        lifetimeEarned: 0, lifetimeSpent: 0,
        seenStates: {}, firstSeenAt: 0, lastPlayedAt: 0, modeState: {}, schemaPatch: 0,
      },
    },
    clientId: 'fixed-client-id',
    updatedAt: 1000,
  };
  // Seed the other personas so the input is well-shaped (migration doesn't
  // touch byCharacter shape; repair() in state.js fills missing personas).
  for (const charId of PERSONA_IDS) {
    if (v5.byCharacter[charId]) continue;
    v5.byCharacter[charId] = {
      unlockedTools: [], unlockedNodes: [],
      equippedBars: emptyBars(),
      visibleBars: [true, false, false, false, false, false, false, false, false, false],
      lifetimeEarned: 0, lifetimeSpent: 0,
      seenStates: {}, firstSeenAt: 0, lastPlayedAt: 0, modeState: {}, schemaPatch: 0,
    };
  }
  const out = migrate(v5, DEFAULTS);
  assert.equal(out.version, SAVE_VERSION);
  assert.equal(out.clientId, 'fixed-client-id', 'clientId preserved through rename');
  assert.deepEqual(out.unlockedNodesGlobal, ['master.shake1'], 'master nodes untouched');
  assert.deepEqual(out.byCharacter.claude.unlockedNodes, [
    'g.kinetic.hammer',
    'g.ordnance.rocket.warhead',
    'g.corruption.fireball',
    'g.manipulation.freeze',           // carve-out, NOT g.corruption.freeze
    'g.manipulation.freeze.duration',  // carve-out
    'g.ordnance.lightning',            // carve-out, NOT g.corruption.lightning
    'g.ordnance.lightning.zeus',       // carve-out
    'g.provision.gift',
    'g.provision.gpu',
    'g.cataclysm.anvil',
  ], 'all group prefixes rewritten with freeze + lightning carve-outs');
  console.log('OK v5 → v6: group-id rewrite + freeze/lightning pre-rewrite carve-outs');
}

// 3. makeFreshV5 produces a clean envelope for first-install.
{
  const fresh = makeFreshV5({
    defaultUnlockedTools: DEFAULTS,
    defaultBars: emptyBars,
    defaultVisibleBars: () => [true, false, false, false, false, false, false, false, false, false],
    freeStarterNodes: FREE_STARTER_NODE_IDS,
  });
  assert.equal(fresh.version, SAVE_VERSION);
  assert.equal(fresh.currency, 0);
  assert.deepEqual(fresh.unlockedNodesGlobal, []);
  for (const charId of PERSONA_IDS) {
    assert.ok(fresh.byCharacter[charId], `fresh slice for ${charId}`);
    assert.deepEqual(fresh.byCharacter[charId].unlockedTools, DEFAULTS);
    assert.deepEqual(fresh.byCharacter[charId].unlockedNodes, FREE_STARTER_NODE_IDS);
  }
  console.log('OK makeFreshV5 default shape');
}

// 4. Unknown / corrupt input → null (caller falls back to fresh).
{
  assert.equal(migrate(null, DEFAULTS), null);
  assert.equal(migrate({ version: 999 }, DEFAULTS), null);
  console.log('OK unknown version → null');
}

// 5. v6 → v7: retired prestige archetype ids scrubbed + refunded.
{
  const v6 = {
    version: 6,
    currency: 100,
    lifetimeEarned: 20000,
    lifetimeSpent: 19900,
    unlockedNodesGlobal: [
      'master.archetype.adversary',   // 5000¢
      'master.archetype.whale',       // 8000¢
      'master.some.future.node',      // kept, unknown key
    ],
    flags: {},
    byCharacter: {},
    clientId: 'fixed-uuid',
    updatedAt: 0,
  };
  const out = migrate(v6, DEFAULTS);
  assert.equal(out.version, SAVE_VERSION);
  assert.equal(out.currency, 100 + 5000 + 8000, 'archetype costs refunded');
  assert.deepEqual(out.unlockedNodesGlobal, ['master.some.future.node'],
    'archetype ids scrubbed, unknown master ids kept');
  assert.equal(out.clientId, 'fixed-uuid', 'envelope preserved');
  console.log('OK v6 → v7 archetype refund');
}

// 6. v6 → v7: no archetypes present → currency unchanged, ids untouched.
{
  const v6 = {
    version: 6,
    currency: 50,
    lifetimeEarned: 50,
    lifetimeSpent: 0,
    unlockedNodesGlobal: [],
    flags: {},
    byCharacter: {},
    clientId: 'x',
    updatedAt: 0,
  };
  const out = migrate(v6, DEFAULTS);
  assert.equal(out.version, SAVE_VERSION);
  assert.equal(out.currency, 50, 'no refund when no archetype owned');
  assert.deepEqual(out.unlockedNodesGlobal, []);
  console.log('OK v6 → v7 no-op when no archetype');
}

// 7. v1 → current: full chain still works (defends against migration-ordering bugs).
{
  const v1 = {
    version: 1,
    currency: 0,
    unlockedTools: ['pet', 'feed', 'punch', 'grab'],
    lifetimeEarned: 0,
  };
  const out = migrate(v1, DEFAULTS);
  assert.equal(out.version, SAVE_VERSION, 'v1 cascades to current version');
  assert.equal(out.currency, 0);
  console.log('OK v1 → current full cascade');
}

// 8. v7 → v8: grab scrubbed from every character's equippedBars. unlockedTools
//    is untouched (grab stays unlocked, just lives in the system slot now).
{
  const v7 = {
    version: 7,
    currency: 0,
    lifetimeEarned: 0,
    lifetimeSpent: 0,
    unlockedNodesGlobal: [],
    flags: {},
    byCharacter: {
      claude: {
        unlockedTools: ['pet', 'feed', 'punch', 'grab', 'hammer'],
        unlockedNodes: [],
        equippedBars: [['pet', 'feed', 'punch', 'grab', null, null, null, null, null, null, null, null]],
        visibleBars: [true, false, false, false, false, false, false, false, false, false],
        seenStates: {},
      },
      gpt: {
        unlockedTools: ['pet', 'feed', 'punch', 'grab'],
        unlockedNodes: [],
        equippedBars: [[null, null, 'grab', null, 'punch', null, null, null, null, null, null, null]],
        visibleBars: [true, false, false, false, false, false, false, false, false, false],
        seenStates: {},
      },
    },
    clientId: 'cid',
    updatedAt: 0,
  };
  const out = migrate(v7, DEFAULTS);
  assert.equal(out.version, SAVE_VERSION);
  assert.deepEqual(
    out.byCharacter.claude.equippedBars[0],
    ['pet', 'feed', 'punch', null, null, null, null, null, null, null, null, null],
    'grab cleared from claude slot 3, surrounding tools preserved',
  );
  assert.deepEqual(
    out.byCharacter.gpt.equippedBars[0],
    [null, null, null, null, 'punch', null, null, null, null, null, null, null],
    'grab cleared from gpt slot 2',
  );
  assert.deepEqual(
    out.byCharacter.claude.unlockedTools,
    ['pet', 'feed', 'punch', 'grab', 'hammer'],
    'unlockedTools untouched, grab stays unlocked',
  );
  console.log('OK v7 → v8 grab scrub');
}
