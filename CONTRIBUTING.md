# Contributing

ClankyBuddy is a toy. There is no roadmap, no SLA, and no promise that any given PR will land. That said, PRs are welcome. Here's how to not waste your own time.

## Before you write code

- **Scope it small.** A 50-line PR fixing one thing will get reviewed. A 2,000-line refactor "while I was in there" will not.
- **Open an issue first if you're adding a tool, persona, or system.** Five minutes of "is this in scope" beats two days of "this isn't in scope."
- **Read [`CLAUDE.md`](./CLAUDE.md).** It's the architecture doc. The patterns there are load-bearing: `abilityCtx`, `ragdollEpoch`, the `TOOLS` table, status effects, the mode bus. Don't fight them.

## Things that will get rejected on sight

- **Meta-progression above the shop.** No prestige, no battle pass, no daily rewards, no dossiers, no reputation systems. The shop IS the progression. This isn't negotiable. It's the game's design spine.
- **Prestige systems that just multiply numbers.** If a "prestige" doesn't give the player a new *verb*, it's a difficulty toggle in disguise.
- **Custom mouse-drag code that fights `MouseConstraint`.** See CLAUDE.md anti-patterns. Just toggle the collision filter mask.
- **Hardcoded tool ids/labels/keys outside the `TOOLS` table.**
- **New `setTimeout` callbacks that don't capture and check `ctx._epoch`.** They misfire after a character switch.

## Running locally

```bash
npm install
npm run dev      # vite on :5173
npm run build    # must pass before pushing
```

## Adding a new ability

There's a checklist in `CLAUDE.md` under "Adding a new ability." Follow it in order. Skipping step 3 (registering in `abilities/index.js` AND `_stats.js`) is the most common miss.

## Commits

Short, human, present tense. No Conventional Commits ceremony. No `Co-Authored-By` trailers. No em-dashes.

## Code of conduct

Don't be a dick. That's it.
