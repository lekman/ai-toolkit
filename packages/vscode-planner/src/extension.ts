/**
 * Extension entry point.
 *
 * Wires the config, dashboard and view domains together and keeps the two
 * panes in step with the file on disk.
 */

import { basename, dirname } from "node:path";
import * as vscode from "vscode";

import type { PaneState, ToggleRequest } from "./view/index.ts";

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
    watch(config.dashboardPath);
    poll(config.dashboardPath, config.pollSeconds);
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
  const poll = (path: null | string, seconds: number) => {
    if (timer) clearInterval(timer);
    timer = undefined;
    if (!path || seconds <= 0) return;
    timer = setInterval(() => {
      const modified = reader.modifiedAt(path);
      if (modified !== lastModified) reload();
    }, seconds * 1000);
  };

  const setShowCompleted = async (value: boolean) => {
    await source.setShowCompleted(value);
    // The configuration listener calls reload(), which re-reads the setting.
  };

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider("planner.today", today),
    vscode.window.registerWebviewViewProvider("planner.tomorrow", tomorrow),
    vscode.commands.registerCommand("planner.refresh", reload),
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
  );

  reload();
}

/** Called by VS Code on shutdown. Disposables are handled by the context. */
export function deactivate(): void {}
