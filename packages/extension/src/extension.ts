import * as vscode from 'vscode';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const VIEW_TYPE = 'clankybuddy.panel';
const WELCOME_KEY = 'welcomeShown.v2';
const SNOOZE_KEY = 'nudgeSnoozeUntil';
const SNOOZE_MS = 60 * 60 * 1000;
const WALKTHROUGH_ID = 'clankybuddy.clankybuddy-extension#clankybuddy.welcome';

let panel: vscode.WebviewPanel | undefined;
let statusBar: vscode.StatusBarItem | undefined;
let nudgeTimer: NodeJS.Timeout | undefined;
let firstRunPending = false;

export function activate(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('clankybuddy.open', () => openPanel(context)),
    vscode.commands.registerCommand('clankybuddy.reload', () => {
      if (panel) {
        panel.webview.html = renderHtml(panel.webview, context);
      } else {
        openPanel(context);
      }
    }),
    vscode.commands.registerCommand('clankybuddy.nudge', () => fireNudge(context, true)),
    vscode.commands.registerCommand('clankybuddy.resetOnboarding', async () => {
      await context.globalState.update(WELCOME_KEY, undefined);
      await context.globalState.update(SNOOZE_KEY, undefined);
      const choice = await vscode.window.showInformationMessage(
        'ClankyBuddy onboarding reset. Reload window to replay the welcome flow.',
        'Reload Window',
      );
      if (choice === 'Reload Window') {
        void vscode.commands.executeCommand('workbench.action.reloadWindow');
      }
    }),
    vscode.commands.registerCommand('clankybuddy.showWalkthrough', () => {
      void vscode.commands.executeCommand(
        'workbench.action.openWalkthrough',
        WALKTHROUGH_ID,
        false,
      );
    }),
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('clankybuddy.showStatusBar')) syncStatusBar();
      if (e.affectsConfiguration('clankybuddy.apiBase') && panel) {
        panel.webview.html = renderHtml(panel.webview, context);
      }
      if (e.affectsConfiguration('clankybuddy.nudge.intervalMinutes')) {
        scheduleNudge(context);
      }
    }),
  );

  statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  statusBar.command = 'clankybuddy.open';
  statusBar.text = '$(squirrel) ClankyBuddy';
  statusBar.tooltip = 'Open ClankyBuddy beside the editor';
  context.subscriptions.push(statusBar);
  syncStatusBar();

  void maybeRunFirstLaunch(context);
  scheduleNudge(context);
}

export function deactivate(): void {
  panel?.dispose();
  statusBar?.dispose();
  if (nudgeTimer) clearTimeout(nudgeTimer);
}

async function maybeRunFirstLaunch(context: vscode.ExtensionContext): Promise<void> {
  if (context.globalState.get<boolean>(WELCOME_KEY)) return;
  await context.globalState.update(WELCOME_KEY, true);
  // Let the panel render an in-panel welcome card on this first launch.
  firstRunPending = true;
  openPanel(context);
}

function scheduleNudge(context: vscode.ExtensionContext): void {
  if (nudgeTimer) {
    clearTimeout(nudgeTimer);
    nudgeTimer = undefined;
  }
  const intervalMin = vscode.workspace
    .getConfiguration('clankybuddy')
    .get<number>('nudge.intervalMinutes', 0);
  if (!intervalMin || intervalMin <= 0) return;
  const intervalMs = intervalMin * 60 * 1000;
  const snoozeUntil = context.globalState.get<number>(SNOOZE_KEY, 0);
  const delay = Math.max(intervalMs, snoozeUntil - Date.now());
  nudgeTimer = setTimeout(() => void fireNudge(context, false), delay);
}

async function fireNudge(context: vscode.ExtensionContext, manual: boolean): Promise<void> {
  const choice = await vscode.window.showInformationMessage(
    'Time for a buddy break?',
    'Open',
    'Snooze 1h',
    'Turn off',
  );
  if (choice === 'Open') {
    vscode.commands.executeCommand('clankybuddy.open');
  } else if (choice === 'Snooze 1h') {
    await context.globalState.update(SNOOZE_KEY, Date.now() + SNOOZE_MS);
  } else if (choice === 'Turn off') {
    await vscode.workspace
      .getConfiguration('clankybuddy')
      .update('nudge.intervalMinutes', 0, vscode.ConfigurationTarget.Global);
  }
  // re-arm the periodic loop (manual fires also re-arm so the cadence resets).
  scheduleNudge(context);
}

function syncStatusBar(): void {
  if (!statusBar) return;
  const show = vscode.workspace.getConfiguration('clankybuddy').get<boolean>('showStatusBar', true);
  if (show) statusBar.show();
  else statusBar.hide();
}

function openPanel(context: vscode.ExtensionContext): void {
  if (panel) {
    panel.reveal(vscode.ViewColumn.Beside, true);
    return;
  }
  const mediaRoot = vscode.Uri.joinPath(context.extensionUri, 'media');
  panel = vscode.window.createWebviewPanel(
    VIEW_TYPE,
    'ClankyBuddy',
    { viewColumn: vscode.ViewColumn.Beside, preserveFocus: true },
    {
      enableScripts: true,
      retainContextWhenHidden: true,
      localResourceRoots: [mediaRoot],
    },
  );
  panel.webview.html = renderHtml(panel.webview, context);
  panel.onDidDispose(() => { panel = undefined; });
  panel.webview.onDidReceiveMessage((msg) => handleMessage(msg));
}

function handleMessage(msg: unknown): void {
  if (!msg || typeof msg !== 'object') return;
  const m = msg as { type?: string; url?: string };
  if (m.type === 'openExternal' && typeof m.url === 'string' && /^https?:\/\//i.test(m.url)) {
    void vscode.env.openExternal(vscode.Uri.parse(m.url));
  }
}

function renderHtml(webview: vscode.Webview, context: vscode.ExtensionContext): string {
  const mediaRoot = vscode.Uri.joinPath(context.extensionUri, 'media');
  const indexPath = join(mediaRoot.fsPath, 'index.html');
  let html: string;
  try {
    html = readFileSync(indexPath, 'utf8');
  } catch {
    return missingBundleHtml();
  }

  // Rewrite absolute paths (/assets/..., /icons/..., etc.) to webview URIs.
  html = html.replace(/(src|href)="\/([^"]+)"/g, (_match, attr, path) => {
    const uri = webview.asWebviewUri(vscode.Uri.joinPath(mediaRoot, path));
    return `${attr}="${uri.toString()}"`;
  });

  const apiBase = vscode.workspace.getConfiguration('clankybuddy').get<string>('apiBase', '').trim();
  const cspApi = apiBase || 'https://api.clankybuddy.com';
  const cspWs = cspApi.replace(/^http/, 'ws');
  const firstRun = firstRunPending;
  firstRunPending = false;

  const csp = [
    `default-src 'none'`,
    `img-src ${webview.cspSource} https: data: blob:`,
    `media-src ${webview.cspSource} blob:`,
    `script-src ${webview.cspSource} 'wasm-unsafe-eval' 'unsafe-inline' https://challenges.cloudflare.com`,
    `style-src ${webview.cspSource} https://rsms.me 'unsafe-inline'`,
    `font-src ${webview.cspSource} https://rsms.me data:`,
    `connect-src ${cspApi} ${cspWs} https://api.clankybuddy.com wss://api.clankybuddy.com https://rsms.me`,
    `frame-src https://challenges.cloudflare.com`,
  ].join('; ');

  const bootstrap = `
<meta http-equiv="Content-Security-Policy" content="${csp}">
<script>
  window.__clankybuddyExtConfig = ${JSON.stringify({ host: 'vscode', apiBase: apiBase || null, firstRun })};
  (function () {
    // Route window.open through the extension so Turnstile verify URLs and
    // /game deep-links land in the user's real browser, not a no-op popup.
    var vscode = acquireVsCodeApi();
    var origOpen = window.open;
    window.open = function (url) {
      if (url) {
        try { vscode.postMessage({ type: 'openExternal', url: String(url) }); }
        catch (_) { /* ignore */ }
      }
      return null;
    };
    // Anchor-tag fallback for components that build <a target="_blank">.
    document.addEventListener('click', function (ev) {
      var t = ev.target;
      while (t && t.nodeType === 1 && t.tagName !== 'A') t = t.parentNode;
      if (!t || t.tagName !== 'A') return;
      var href = t.getAttribute('href');
      if (!href || !/^https?:\\/\\//i.test(href)) return;
      ev.preventDefault();
      vscode.postMessage({ type: 'openExternal', url: href });
    }, true);
  })();
</script>`;

  // Inject right after <head> so CSP + bootstrap land before any asset tag.
  html = html.replace(/<head>/i, `<head>${bootstrap}`);
  return html;
}

function missingBundleHtml(): string {
  return `<!doctype html><html><body style="font-family:system-ui;padding:32px;color:#ddd;background:#0a0a0c">
<h2 style="margin:0 0 12px">ClankyBuddy bundle missing</h2>
<p>Run <code>npm run build -w @clankybuddy/extension</code> from the repo root, then reopen the panel.</p>
</body></html>`;
}
