// Central JSDoc typedef hub. Pure declarations, no runtime exports.
// Modules opt in by adding `// @ts-check` at the top, then either
// `/** @typedef {import('../types.js').Ability} Ability */` to alias a name,
// or annotate the default export with `/** @type {import('../types.js').Ability} */`.
//
// Editor checking is enabled per-file via `// @ts-check` so you can roll the
// pass out gradually. jsconfig.json keeps `checkJs` off at the project level
// so untyped files stay quiet.

// ─── Matter re-exports ────────────────────────────────────────────────────

/** @typedef {import('matter-js').Body}        MatterBody */
/** @typedef {import('matter-js').World}       MatterWorld */
/** @typedef {import('matter-js').Composite}   MatterComposite */
/** @typedef {import('matter-js').Constraint}  MatterConstraint */

// ─── Bodies extended with our metadata ────────────────────────────────────

/**
 * Every transient projectile / pool / ragdoll part is a Matter body with
 * extra fields we mutate directly on the body. Centralized here so adding a
 * new lifecycle field (e.g. _spawnedBy) is one edit, not a hunt.
 *
 * @typedef {MatterBody & {
 *   partType?: PartType,
 *   bornAt?: number,
 *   lifeMs?: number,
 *   fuseAt?: number,
 *   onHit?: (self: ExtBody, world: MatterWorld, ctx: AbilityCtx) => void,
 *   onExpire?: (self: ExtBody, ctx: AbilityCtx) => void,
 *   _spent?: boolean,
 *   _lastIgnite?: number,
 *   _lastFuseBeep?: number,
 *   _scorchedUntil?: number,
 * }} ExtBody
 */

/**
 * Union of every value seen at runtime for `body.partType`. Ragdoll parts
 * use head/torso/arm/leg; transients use their handler key.
 *
 * @typedef {'head'|'torso'|'arm'|'leg'
 *   |'treat'|'gift'|'bullet'|'firepool'
 *   |'grenade'|'rocket'|'fireball'|'anvil'
 *   |'brick'|'bowling_ball'|'piano'} PartType
 */

// ─── Ragdoll ──────────────────────────────────────────────────────────────

/**
 * @typedef {{
 *   composite: MatterComposite,
 *   parts: ExtBody[],
 *   head: ExtBody,
 *   chest: ExtBody,
 *   character: Character,
 *   bodyMap: { head: ExtBody, body: ExtBody, armL: ExtBody, armR: ExtBody, legL: ExtBody, legR: ExtBody },
 * }} Ragdoll
 */

/**
 * Roster entry from physics/characters.js. Keep loose, fields are read by
 * render/branding code; the shape evolves more than the rest.
 *
 * @typedef {{ id: string, name: string, accent?: string, drawLogo?: Function } & Record<string, any>} Character
 */

// ─── Mood ─────────────────────────────────────────────────────────────────

/**
 * @typedef {{
 *   happiness: number,
 *   pets: number,
 *   hits: number,
 *   lastShockAt: number,
 *   lastBubbleAt: number,
 *   lastBubbleText: string,
 *   invulnUntil: number,
 *   lastNegHitAt: number,
 *   fear: number,
 *   joy: number,
 *   lastFearAt: number,
 *   lastJoyAt: number,
 *   shock: number,
 *   lastShockSpikeAt: number,
 * }} Mood
 */

/** @typedef {'ECSTATIC'|'HAPPY'|'CONTENT'|'WORRIED'|'HURT'|'BROKEN'} MoodStateName */

// ─── Status effects ───────────────────────────────────────────────────────

/** @typedef {'on_fire'|'frozen'|'electrified'|'powered'|'in_blackhole'|'concussed'} StatusEffectId */

/**
 * One active status on one part. Effect modules read/write the underscored
 * fields (_spoken, _lastSpreadAt) for their own scratch state.
 *
 * @typedef {{
 *   effect: StatusEffectId,
 *   part: ExtBody,
 *   startedAt: number,
 *   expiresAt: number,
 *   intensity: number,
 *   source: string | null,
 *   data: any | null,
 *   onExpire: ((rec: StatusRecord, natural: boolean) => void) | null,
 *   _spoken?: boolean,
 *   _lastSpreadAt?: number,
 * }} StatusRecord
 */

/** @typedef {{ map: Map<number, Map<StatusEffectId, StatusRecord>> }} StatusRegistry */

/**
 * Status-effect plugin contract. Files in src/effects/ export one of these as
 * default. `layer` controls render order around the body in render/index.js.
 *
 * @typedef {{
 *   id: StatusEffectId,
 *   defaultDuration: number,
 *   layer: 'under' | 'over',
 *   onApply?: (part: ExtBody, rec: StatusRecord, reg: StatusRegistry) => void,
 *   onRemove?: (part: ExtBody, rec: StatusRecord, reg: StatusRegistry) => void,
 *   onTick?: (part: ExtBody, rec: StatusRecord, ctx: AbilityCtx, dtMs: number, now: number) => void,
 *   render?: (rctx: CanvasRenderingContext2D, ragdoll: Ragdoll, records: { part: ExtBody, rec: StatusRecord }[], now: number) => void,
 * }} Effect
 */

// ─── Ability ctx (the everything-bag passed to apply / applyRelease) ──────

/**
 * Every ability receives this object. Built by abilityCtx() in
 * state/ability-ctx.js. Add a field here AND there, the typedef and the
 * factory should match.
 *
 * Optional fields (x/y/dragStart/dragVec) come from input/mouse.js via the
 * `extra` spread, and are only present for the input shape that needs them.
 *
 * @typedef {{
 *   buddyId: string,
 *   ragdoll: Ragdoll,
 *   mood: Mood,
 *   status: StatusRegistry,
 *   world: MatterWorld,
 *   transientBodies: ExtBody[],
 *   screenShake: (intensity: number, durationMs: number) => void,
 *   popBubble: (part: ExtBody, text: string) => void,
 *   hitStop: (durationMs: number, scale: number) => void,
 *   recordHit: (hit: { verb?: string, character?: string, part: ExtBody, impulse?: number, intensity?: number, moodDelta: number, comboIndex?: number, kind?: 'hit'|'reward'|'neutral' }) => void,
 *   reactTo: (req: { source?: string, part?: ExtBody, moodDelta?: number, intensity?: number, impulse?: number, speakMs?: number, kind?: 'hit'|'reward'|'neutral' }) => string | null,
 *   _spawnFirePool: (x: number, y: number, durationMs: number) => ExtBody,
 *   _epoch: number,
 *   _epochValid: (saved: number) => boolean,
 *   _verb?: string,
 *   x?: number,
 *   y?: number,
 *   dragStart?: { x: number, y: number },
 *   dragVec?: { x: number, y: number },
 * }} AbilityCtx
 */

// ─── Ability ──────────────────────────────────────────────────────────────

/**
 * Ability plugin contract. Files in src/abilities/<group>/ export one of
 * these as default. Dispatch matches `kind` from ui/tools-table.js:
 *   click / hold       → apply(ctx)
 *   drag / hold+drag   → applyRelease(ctx) on mouseup, with dragVec on ctx
 *
 * @typedef {{
 *   id: string,
 *   defaultStats?: Record<string, any>,
 *   apply?: (ctx: AbilityCtx) => void,
 *   applyRelease?: (ctx: AbilityCtx) => void,
 *   drawCursor?: (rctx: CanvasRenderingContext2D, opts: CursorDrawOpts) => void,
 * }} Ability
 */

/**
 * @typedef {{
 *   x: number,
 *   y: number,
 *   isDown?: boolean,
 *   dragStart?: { x: number, y: number } | null,
 *   gravityY?: number,
 * }} CursorDrawOpts
 */

// ─── Transient handler (collision-by-partType dispatch) ───────────────────

/**
 * Files in src/transients/ export one of these as default. Registered by
 * partType in transients/index.js. `removeOnContact: false` keeps the body
 * alive after a hit (firepool sensors, anvil pancakes).
 *
 * @typedef {{
 *   partType: PartType,
 *   removeOnContact: boolean,
 *   onContact: (self: ExtBody, target: ExtBody, ctx: AbilityCtx) => void,
 * }} TransientHandler
 */

// Re-export an empty object so this file is treated as a module, not a script.
export {};
