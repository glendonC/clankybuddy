# ClankyBuddy for VS Code / Cursor / Windsurf

Beside-the-editor panel that loads the ClankyBuddy web game inside a webview. Same bundle, same backend (`api.clankybuddy.com`). Auth, leaderboard, chat all flow through the existing worker.

## Run locally (dev host)

From the repo root:

```bash
npm install
npm run build -w clankybuddy-extension
```

Then open `packages/extension/` in VS Code (or Cursor) and press `F5`. An Extension Development Host window launches; run `> ClankyBuddy: Open` from the command palette, or click the buddy in the status bar.

## Settings

- `clankybuddy.apiBase`: override the worker base URL (e.g. `http://localhost:8788` to run against `wrangler dev`). Empty falls through to the bundled production default.
- `clankybuddy.showStatusBar`: hide the status-bar entry.

> Note: the npm package name is unscoped (`clankybuddy-extension`) because the VS Code Marketplace rejects scoped names. Workspace selectors use `-w clankybuddy-extension`, not `@clankybuddy/extension`.

## What's in here

- `src/extension.ts`: activate hook, webview panel singleton, asset URL rewriting, CSP, external-link bridge.
- `scripts/bundle-web.mjs`: builds `@clankybuddy/web` and copies its `dist/` into `media/`. Strips the PWA service-worker registration (service workers don't run in `vscode-webview://`).
- `media/`: produced by the bundle script. Not committed.
- `out/`: TypeScript output. Not committed.

## Publishing

Not wired yet. When ready:

```bash
npx vsce publish      # Microsoft VS Code Marketplace
npx ovsx publish      # Open VSX (Cursor / Windsurf default)
```

Both endpoints take the same `.vsix`.
