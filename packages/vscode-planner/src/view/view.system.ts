/** VS Code webview adapter for the view domain. */

import { randomBytes } from "node:crypto";
import * as vscode from "vscode";

import type { PlannerConfig } from "../config/types.ts";
import type { Day } from "../dashboard/types.ts";

import { View } from "./view.ts";

/** How many days after today a pane shows. */
export type PaneOffset = 0 | 1;

/** A click on a checkbox in the pane. */
export interface ToggleRequest {
  /** The state the pane was showing: true for `- [x]`. */
  done: boolean;
  /** Zero-based line of the checkbox in the dashboard's markdown. */
  line: number;
}

/** What the provider needs to know at render time. */
export interface PaneState {
  config: PlannerConfig;
  dashboardMissing: boolean;
  days: Day[];
  today: Date;
}

/** Renders one pane — Today or Tomorrow — into a webview view. */
export class PlannerViewProvider implements vscode.WebviewViewProvider {
  private view: undefined | vscode.WebviewView;

  /**
   * Create a provider for one pane.
   *
   * @param offset - 0 for today, 1 for tomorrow.
   * @param getState - Returns the current state at render time. A callback,
   * not a value, so a refresh does not have to re-register the provider.
   * @param onToggle - Called when a checkbox is clicked. The provider does not
   * write anything itself; the extension owns the file.
   */
  constructor(
    private readonly offset: PaneOffset,
    private readonly getState: () => PaneState,
    private readonly onToggle?: (request: ToggleRequest) => void,
  ) {}

  /**
   * Called by VS Code when the view first becomes visible.
   *
   * @param webviewView - The view to populate.
   */
  resolveWebviewView(webviewView: vscode.WebviewView): void {
    this.view = webviewView;
    webviewView.webview.options = {
      // One inline script, nonce'd by the content security policy, whose only
      // job is to post a click back. It renders nothing and reads nothing.
      enableScripts: true,
      // An allow-list of exactly one command, not `true`. `true` would let
      // any text in the dashboard invoke any command in the window,
      // including ones that write files or run tasks.
      enableCommandUris: ["markdown.showPreview"],
    };

    // Messages arrive from a page this extension generated and escaped, but
    // they are still shaped by whatever is running in the webview, so the
    // fields are checked rather than trusted. A line that is not a
    // non-negative integer is dropped here rather than reaching the file.
    webviewView.webview.onDidReceiveMessage((message: unknown) => {
      if (!this.onToggle || typeof message !== "object" || message === null) {
        return;
      }
      const { done, line, type } = message as Record<string, unknown>;
      if (type !== "toggle") return;
      if (typeof line !== "number" || !Number.isInteger(line) || line < 0) {
        return;
      }
      if (typeof done !== "boolean") return;
      this.onToggle({ done, line });
    });

    this.render();
  }

  /** Re-render the pane from current state. Safe before the view exists. */
  render(): void {
    if (!this.view) return;
    const state = this.getState();
    const date = new Date(state.today);
    date.setDate(date.getDate() + this.offset);

    const model = View.model(
      state.days,
      date,
      state.config,
      state.dashboardMissing,
    );
    const nonce = randomBytes(16).toString("base64");
    this.view.webview.html = View.html(
      model,
      nonce,
      this.view.webview.cspSource,
    );
  }
}
