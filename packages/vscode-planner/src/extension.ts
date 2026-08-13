/**
 * Extension entry point.
 *
 * Wires the config, dashboard and view domains together and keeps the two
 * panes in step with the file on disk.
 */

import { basename, dirname } from "node:path";
import * as vscode from "vscode";

import type { PaneState } from "./view/index.ts";

import { Config, VscodeConfigSource } from "./config/index.ts";
import { Dashboard, FileDashboardReader } from "./dashboard/index.ts";
import { PlannerViewProvider } from "./view/index.ts";

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

  const today = new PlannerViewProvider(0, () => state);
  const tomorrow = new PlannerViewProvider(1, () => state);

  let watcher: undefined | vscode.FileSystemWatcher;

  const reload = () => {
    const config = Config.load(source);
    const markdown = config.dashboardPath
      ? reader.read(config.dashboardPath)
      : null;

    state = {
      config,
      dashboardMissing: config.dashboardPath !== null && markdown === null,
      days: markdown ? Dashboard.parse(markdown, new Date()) : [],
      today: new Date(),
    };

    today.render();
    tomorrow.render();
    watch(config.dashboardPath);
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

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider("planner.today", today),
    vscode.window.registerWebviewViewProvider("planner.tomorrow", tomorrow),
    vscode.commands.registerCommand("planner.refresh", reload),
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
    // iCloud writes the vault from another process, and those writes do not
    // always surface as watcher events. Refocusing the window re-reads, which
    // also picks up a date rollover across an overnight session.
    vscode.window.onDidChangeWindowState((window) => {
      if (window.focused) reload();
    }),
  );

  reload();
}

/** Called by VS Code on shutdown. Disposables are handled by the context. */
export function deactivate(): void {}
