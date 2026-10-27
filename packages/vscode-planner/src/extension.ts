/**
 * Extension entry point.
 *
 * Wires the config, dashboard, view and Atlas domains together. When the
 * Atlas page can be read, the sidebar shows it, the same page the Claude
 * artifact runs; otherwise it shows the Today and Tomorrow panes, kept in
 * step with `Dashboard.md`.
 */

import { basename, dirname, join } from "node:path";
import * as vscode from "vscode";

import type { AtlasState } from "./atlas/index.ts";
import type { PaneState, ToggleRequest } from "./view/index.ts";

import {
  Atlas,
  AtlasFiles,
  AtlasViewProvider,
  FileDocStore,
  StdioToolHost,
} from "./atlas/index.ts";
import { Config, VscodeConfigSource } from "./config/index.ts";
import {
  ConnectorHub,
  type ConnectorName,
  LocalCredentials,
  MONDAY_SECRET,
} from "./connectors/index.ts";
import { Dashboard, FileDashboardReader } from "./dashboard/index.ts";
import { Explorer } from "./explorer/index.ts";
import { PlannerViewProvider } from "./view/index.ts";

/** The Atlas page's `localStorage`, kept for every window. */
const STORAGE_STATE = "atlas.storage";

/** The client last chosen on the Atlas page, kept per workspace. */
const FOCUS_STATE = "atlas.focus";

/**
 * Activate the extension.
 *
 * @param context - The extension context, which owns every disposable.
 */
export function activate(context: vscode.ExtensionContext): void {
  const source = new VscodeConfigSource();
  const reader = new FileDashboardReader();

  let state: PaneState = {
    config: Config.load(source),
    dashboardMissing: false,
    days: [],
    today: new Date(),
  };

  /**
   * Apply a checkbox click to the file.
   *
   * The pane renders a snapshot, and the vault is written by Obsidian, by
   * iCloud sync and by other agents, so the file is re-read here rather than
   * the parsed state being trusted. Dashboard.toggle refuses when the line is
   * no longer the checkbox the pane was showing, and a refusal reloads instead
   * of writing — the worst outcome of a stale click is a redraw, never a task
   * ticked that nobody clicked.
   */
  const applyToggle = ({ done, line }: ToggleRequest) => {
    const path = state.config.dashboardPath;
    if (!path) return;

    const markdown = reader.read(path);
    if (markdown === null) {
      reload();
      return;
    }

    const updated = Dashboard.toggle(markdown, line, done);
    if (updated === null) {
      void vscode.window.showWarningMessage(
        "That task changed on disk, so it was not updated. The panel has been refreshed.",
      );
      reload();
      return;
    }

    if (!reader.write(path, updated)) {
      void vscode.window.showErrorMessage(`Could not write ${path}.`);
    }
    // Either way, re-read: the pane must show the file, not the request.
    reload();
  };

  const today = new PlannerViewProvider(0, () => state, applyToggle);
  const tomorrow = new PlannerViewProvider(1, () => state, applyToggle);

  // The Atlas page keeps its own timers and fetches its own data, so it is
  // rendered again only when the page file, the server or the client it
  // opens on changes. Rendering it on every dashboard reload would restart
  // it each time the window took focus.
  let atlas: AtlasState = { focus: null, pagePath: null, source: null };
  let atlasKey = "";
  let atlasServerKey = "";
  let atlasModified: null | number = null;
  let host = new StdioToolHost(null);
  const store = new FileDocStore(
    join(context.globalStorageUri.fsPath, "atlas-store.json"),
  );
  const atlasView = new AtlasViewProvider(
    () => atlas,
    {
      callTool: (tool, args) => host.callTool(tool, args),
      dispose: () => host.dispose(),
    },
    store,
    new ConnectorHub(new LocalCredentials(context.secrets), () =>
      vscode.workspace
        .getConfiguration("planner")
        .get<ConnectorName[]>("connectors", [
          "github",
          "microsoft365",
          "monday",
        ]),
    ),
    {
      snapshot: () =>
        Atlas.storageSnapshot(
          context.globalState.get<Record<string, string>>(STORAGE_STATE, {}),
          context.workspaceState.get<string>(FOCUS_STATE) ?? null,
          atlas.focus,
        ),
      set: (key, value) => {
        if (Atlas.storageScope(key) === "workspace") {
          void context.workspaceState.update(FOCUS_STATE, value ?? undefined);
          return;
        }
        const saved = {
          ...context.globalState.get<Record<string, string>>(STORAGE_STATE, {}),
        };
        if (value === null) delete saved[key];
        else saved[key] = value;
        void context.globalState.update(STORAGE_STATE, saved);
      },
    },
  );

  // The token goes to SecretStorage, the macOS Keychain, and never to the
  // settings, which are plain text and copied by Settings Sync. The page is
  // reloaded afterwards, because it stops asking a connector it was told is
  // not available.
  const setMondayToken = async () => {
    const token = await vscode.window.showInputBox({
      ignoreFocusOut: true,
      password: true,
      prompt:
        "monday.com personal API token (Profile → Developers → API token). Stored in the Keychain.",
      title: "Atlas: Set monday.com Token",
    });
    if (!token?.trim()) return;
    await context.secrets.store(MONDAY_SECRET, token.trim());
    reloadAtlas(Config.load(source), true);
  };
  const clearMondayToken = async () => {
    await context.secrets.delete(MONDAY_SECRET);
    reloadAtlas(Config.load(source), true);
  };

  const reloadAtlas = (config: PaneState["config"], force: boolean) => {
    const server = Atlas.hostServer(
      AtlasFiles.desktopConfig(),
      config.atlasServer,
    );
    const serverKey = JSON.stringify(server);
    if (serverKey !== atlasServerKey) {
      host.dispose();
      host = new StdioToolHost(server);
      atlasServerKey = serverKey;
    }

    const pagePath = config.atlasPagePath;
    const modified = pagePath ? AtlasFiles.modifiedAt(pagePath) : null;
    const focus = Atlas.focusKey(config.clients);
    const key = JSON.stringify([pagePath, modified, focus, serverKey]);
    if (!force && key === atlasKey) return;
    atlasKey = key;
    atlasModified = modified;
    atlas = {
      focus,
      pagePath,
      source: pagePath ? AtlasFiles.readPage(pagePath) : null,
    };
    void vscode.commands.executeCommand(
      "setContext",
      "planner.atlasAvailable",
      atlas.source !== null,
    );
    atlasView.render();
  };

  let watcher: undefined | vscode.FileSystemWatcher;
  let timer: NodeJS.Timeout | undefined;
  let lastModified: null | number = null;

  const reload = () => {
    const config = Config.load(source);
    const markdown = config.dashboardPath
      ? reader.read(config.dashboardPath)
      : null;

    lastModified = config.dashboardPath
      ? reader.modifiedAt(config.dashboardPath)
      : null;

    state = {
      config,
      dashboardMissing: config.dashboardPath !== null && markdown === null,
      days: markdown ? Dashboard.parse(markdown, new Date()) : [],
      today: new Date(),
    };

    void vscode.commands.executeCommand(
      "setContext",
      "planner.completedVisible",
      config.showCompleted,
    );

    today.render();
    tomorrow.render();
    reloadAtlas(config, false);
    watch(config.dashboardPath);
    poll(config.dashboardPath, config.pollSeconds, config.atlasPagePath);
  };

  // The dashboard lives in the vault, outside the workspace, so the watcher is
  // scoped to its own directory rather than to any workspace folder. It is
  // rebuilt whenever the path changes.
  const watch = (path: null | string) => {
    watcher?.dispose();
    watcher = undefined;
    if (!path) return;
    watcher = vscode.workspace.createFileSystemWatcher(
      new vscode.RelativePattern(
        vscode.Uri.file(dirname(path)),
        basename(path),
      ),
    );
    watcher.onDidChange(reload);
    watcher.onDidCreate(reload);
    watcher.onDidDelete(reload);
    context.subscriptions.push(watcher);
  };

  // Polling backs the watcher up rather than replacing it. A vault synced by
  // iCloud is written by another process, and those writes do not reliably
  // raise a watcher event; a stat every few seconds costs nothing and is the
  // difference between the panes being right and being quietly stale.
  // The Atlas page sits in the same synced vault, so the same poll covers it.
  const poll = (
    path: null | string,
    seconds: number,
    atlasPath: null | string,
  ) => {
    if (timer) clearInterval(timer);
    timer = undefined;
    if ((!path && !atlasPath) || seconds <= 0) return;
    timer = setInterval(() => {
      if (path && reader.modifiedAt(path) !== lastModified) reload();
      else if (
        atlasPath &&
        AtlasFiles.modifiedAt(atlasPath) !== atlasModified
      ) {
        reload();
      }
    }, seconds * 1000);
  };

  // Writes the user settings, where the list lives, so other extensions that
  // read `files.exclude` see the same state.
  const toggleHiddenFiles = async () => {
    const files = vscode.workspace.getConfiguration("files");
    const exclude =
      files.inspect<Record<string, unknown>>("exclude")?.globalValue ?? {};
    const remembered = context.globalState.get<string[]>(
      "planner.hiddenPatterns",
      [],
    );
    const result = Explorer.toggle(exclude, remembered);
    await files.update(
      "exclude",
      result.exclude,
      vscode.ConfigurationTarget.Global,
    );
    await context.globalState.update(
      "planner.hiddenPatterns",
      result.remembered,
    );
    void vscode.window.setStatusBarMessage(
      result.hidden
        ? "Atlas: hidden files are hidden"
        : "Atlas: hidden files are shown",
      3000,
    );
  };

  const setShowCompleted = async (value: boolean) => {
    await source.setShowCompleted(value);
    // The configuration listener calls reload(), which re-reads the setting.
  };

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider("planner.today", today),
    vscode.window.registerWebviewViewProvider("planner.tomorrow", tomorrow),
    // Kept alive while hidden, so the page's timers and fetches carry on
    // the way they do in the artifact sidebar.
    vscode.window.registerWebviewViewProvider("planner.atlas", atlasView, {
      webviewOptions: { retainContextWhenHidden: true },
    }),
    vscode.commands.registerCommand("planner.refresh", () => {
      reload();
      reloadAtlas(Config.load(source), true);
    }),
    vscode.commands.registerCommand("planner.setMondayToken", setMondayToken),
    vscode.commands.registerCommand(
      "planner.clearMondayToken",
      clearMondayToken,
    ),
    vscode.commands.registerCommand(
      "planner.toggleHiddenFiles",
      toggleHiddenFiles,
    ),
    vscode.commands.registerCommand("planner.hideCompleted", () =>
      setShowCompleted(false),
    ),
    vscode.commands.registerCommand("planner.showCompleted", () =>
      setShowCompleted(true),
    ),
    vscode.commands.registerCommand("planner.openDashboard", async () => {
      const path = Config.load(source).dashboardPath;
      if (!path) {
        await vscode.window.showWarningMessage(
          "Planner: no dashboard configured. Set planner.dashboardPath.",
        );
        return;
      }
      await vscode.window.showTextDocument(vscode.Uri.file(path));
    }),
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration("planner")) reload();
    }),
    // Refocusing the window re-reads, which also picks up a date rollover
    // across an overnight session.
    vscode.window.onDidChangeWindowState((window) => {
      if (window.focused) reload();
    }),
    { dispose: () => timer && clearInterval(timer) },
    { dispose: () => host.dispose() },
  );

  reload();
}

/** Called by VS Code on shutdown. Disposables are handled by the context. */
export function deactivate(): void {}
