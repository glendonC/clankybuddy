# Security

Found something? Please report it privately. Don't open a public issue.

**Use GitHub's [private vulnerability reporting](https://github.com/glendonC/clankybuddy/security/advisories/new).** It's the preferred channel.

## In scope

- The Cloudflare worker (`packages/worker/`): auth, age gate, chat ingest, leaderboard aggregation
- The web client (`packages/web/`): anything touching auth, save state, or user input handed to the worker
- Anything in `packages/shared/` that affects the wire format

## Out of scope

- Game balance, tool damage numbers, mood tuning. That's design, not security. Open a regular issue.
- "I can use the dev console to wipe my save." Yes. It's a single-player toy. That's intentional.
- Third-party CDN/asset issues.

## Response

This is a side project maintained by one person. I'll acknowledge reports as fast as I reasonably can, but there's no SLA. Critical issues get prioritized; everything else gets handled in order.
