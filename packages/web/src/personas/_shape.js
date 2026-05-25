// Persona shape, JSDoc-only (no runtime exports). Every src/personas/<id>.js
// assembles an object matching this typedef. A persona is the union of:
//   - identity / branding (id, displayName, provider, body palette, logo)
//   - speech (mood-state pools, status-event pools, action-event pools)
//   - mechanic hooks (panicMove, aiFeedback)
//   - optional plumbing tunables (per-persona dodge probability multiplier,
//     context-window stamina, hallucination overrides, etc.)
//   - optional signature mechanic flags (cloning, decoys, bullet shield, ...)
//   - optional costume layer (PR3, reserved here, NOT implemented in PR1)
//
// PR1 wires the registry as a thin proxy over existing modules. PR2 will
// relocate the actual data (speech pools, panic handlers, dodge lines) into
// these files. Keep the shape stable across both PRs so consumers can opt
// in to importing from src/personas/index.js immediately.
//
// SOURCE: docs/ideas.md (persona vision) + the planning agent's design.
// Anything added here should be reflected in tests/personas.test.js so a
// PR that drops a field fails fast.

/**
 * @typedef {Object} PanicMove
 * @property {string} id                       Stable id (e.g. 'refusal-shield').
 * @property {string} [label]                  Human-readable name for UI ('Refusal Shield').
 *                                             Used by the target picker / shop chrome.
 * @property {number} invulnMs                 Default mood.invulnUntil window.
 * @property {number} durationMs               How long the move's overlay/state lasts.
 * @property {(ctx: any) => void} apply        Fires the move. Pulls from ctx (ragdoll, mood, popBubble, ...).
 * @property {(ctx: any) => void} [tick]       Optional per-frame updater for sticky moves.
 * @property {() => void} [cleanup]            Optional teardown (DOM nodes, listeners).
 */

/**
 * @typedef {Object} AiFeedback
 * @property {string[]} dodgeLines             Spoken when the buddy successfully dodges.
 * @property {string} [refusalTag]             Per-persona refusal sigil (e.g. '<refusal>', '[REFUSED]').
 *
 * The `hallucinations` and `toolCalls` fields were retired 2026-05-24 along
 * with the plumbing cosmetic module (tool-call hammer, stackoverflow.com
 * RAG tab). They were passive wallpaper-comedy that broke the action loop.
 */

/**
 * @typedef {Object} PersonaPlumbing
 * @property {number} [dodgeProbabilityMul]    Multiplier on base dodge probability (1.0 default).
 * @property {number} [contextWindowSize]      Stamina meter cap; future ticker.
 * @property {number} [tokenBudget]            Soft cap on outgoing speech-bubble cadence.
 * @property {boolean} [quantizable]           Toggle for the planned quantization debuff.
 * @property {(ctx: any) => void} [onMcpPing]  Cross-buddy reaction hook (future).
 */

/**
 * @typedef {Object} PersonaSignature
 * @property {boolean} [spawnClones]           Llama "fork", multiplies hitboxes briefly.
 * @property {boolean} [outgoingProjectile]    Grok "punch back", fires a return projectile.
 * @property {boolean} [decoyField]            Gemini "generating decoys", overlay-only or real.
 * @property {boolean} [bulletShield]          GPT "while I can't endorse violence", destructible.
 * @property {boolean} [stockCrash]            DeepSeek, full-screen ticker dive (cut for now).
 */

/**
 * @typedef {Object} PersonaCostume
 * @property {(ctx: any) => void} draw         Render hook. RESERVED for PR3, not used in PR1.
 * @property {'under'|'over'} layer            Drawn under or over the head logo.
 */

/**
 * @typedef {Object} Persona
 * @property {string} id                       ModelId, must match PERSONA_IDS in shared.
 * @property {string} displayName              Human-readable name (e.g. 'Claude').
 * @property {string} provider                 Vendor name (e.g. 'Anthropic').
 * @property {string} [tagline]                Short reputation hook ('World's Most Annoying Coworker').
 *                                             Surfaces in the target picker card and shop chrome.
 * @property {string} body                     Hex fill for the head/torso primary.
 * @property {string} bodyDark                 Hex fill for the shadowed side.
 * @property {string} accent                   Theme accent (chrome, slot active, picker glow).
 * @property {(ctx: CanvasRenderingContext2D, r: number) => void} drawLogo
 *           Canvas draw hook centered at (0,0); fills ~75% of the head circle.
 * @property {string|null} logoSvg             Raw SVG string (or null if not yet wired).
 * @property {Record<string, string[]>} speechPools
 *           Flat dict keyed by `mood:STATE` / `event` / `event:STATE`. See reactions/pools.js.
 * @property {PanicMove} panicMove
 * @property {AiFeedback} aiFeedback
 * @property {PersonaPlumbing} [plumbing]
 * @property {PersonaSignature} [signature]
 * @property {PersonaCostume} [costume]        RESERVED for PR3, not implemented in PR1.
 */

export {};
