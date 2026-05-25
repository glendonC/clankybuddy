#!/usr/bin/env node
// Build @clankybuddy/web and stage its dist/ into ../media/ for the webview.
// Strips the PWA service-worker registration on the way in — service workers
// cannot register under the vscode-webview:// scheme, and leaving the tag in
// throws a console error every time the panel opens.

import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, rmSync, cpSync, existsSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const extRoot = resolve(here, '..');
const repoRoot = resolve(extRoot, '..', '..');
const webDist = join(repoRoot, 'packages', 'web', 'dist');
const mediaDir = join(extRoot, 'media');

function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { stdio: 'inherit', cwd: repoRoot, ...opts });
  if (r.status !== 0) {
    process.exit(r.status ?? 1);
  }
}

console.log('[bundle-web] building @clankybuddy/web…');
run('npm', ['run', 'build', '-w', '@clankybuddy/web']);

if (!existsSync(webDist)) {
  console.error(`[bundle-web] expected dist at ${webDist} after build, missing`);
  process.exit(1);
}

console.log(`[bundle-web] copying ${webDist} → ${mediaDir}`);
rmSync(mediaDir, { recursive: true, force: true });
cpSync(webDist, mediaDir, { recursive: true });

const indexPath = join(mediaDir, 'index.html');
let html = readFileSync(indexPath, 'utf8');
const before = html.length;

// Strip the PWA registration script — vscode-webview:// can't host a SW.
html = html.replace(
  /<script[^>]*id=["']vite-plugin-pwa:register-sw["'][^>]*><\/script>/,
  '',
);
// Strip the manifest link too — irrelevant in a webview.
html = html.replace(
  /<link[^>]*rel=["']manifest["'][^>]*>/,
  '',
);

if (html.length === before) {
  console.warn('[bundle-web] warning: no PWA tags removed from index.html (Vite-PWA layout may have changed)');
}

writeFileSync(indexPath, html, 'utf8');

// Drop the SW + workbox files from media/ — extension never serves them.
for (const stale of ['sw.js', 'registerSW.js', 'manifest.webmanifest']) {
  const p = join(mediaDir, stale);
  if (existsSync(p)) rmSync(p);
}
// Workbox runtime is hash-suffixed; pattern-match.
import('node:fs').then(({ readdirSync }) => {
  for (const name of readdirSync(mediaDir)) {
    if (/^workbox-[a-f0-9]+\.js$/i.test(name)) {
      rmSync(join(mediaDir, name));
    }
  }
});

console.log('[bundle-web] done.');
