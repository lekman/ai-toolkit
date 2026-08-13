/**
 * Builds one pane's HTML.
 *
 * Pure: it takes a model and returns a string. Nothing here touches VS Code,
 * the filesystem, or the clock.
 */

import type { PlannerConfig } from "../config/types.ts";
import type { Day } from "../dashboard/types.ts";
import type { PaneModel } from "./types.ts";

import { Dashboard } from "../dashboard/dashboard.ts";
import { Markdown } from "../dashboard/markdown.ts";

/** Renders a pane of tasks as a self-contained HTML document. */
export class View {
  /**
   * Decide what a pane should show.
   *
   * The three empty states are distinct on purpose: an unreadable dashboard is
   * a setup problem, a missing heading means the day was never planned, and a
   * heading with no matching tasks means the filter excluded them all. Showing
   * one blank pane for all three would hide a misconfiguration.
   *
   * @param days - Every parsed day.
   * @param date - The day this pane shows.
   * @param config - The resolved configuration.
   * @param dashboardMissing - True when the file could not be read.
   * @returns The model for this pane.
   */
  static model(
    days: Day[],
    date: Date,
    config: PlannerConfig,
    dashboardMissing: boolean,
  ): PaneModel {
    if (config.problem) {
      return {
        groups: [],
        heading: null,
        message: config.problem,
        showClientHeadings: false,
      };
    }
    if (dashboardMissing) {
      return {
        groups: [],
        heading: null,
        message: `Could not read ${config.dashboardPath}.`,
        showClientHeadings: false,
      };
    }

    const day = Dashboard.dayOn(days, date);
    if (!day) {
      return {
        groups: [],
        heading: null,
        message: "Nothing planned.",
        showClientHeadings: false,
      };
    }

    const groups = Dashboard.filterGroups(day, config.clients);
    const showClientHeadings =
      config.showClientHeadings === "always" ||
      (config.showClientHeadings === "auto" && groups.length > 1);

    if (groups.length === 0) {
      const filtered = config.clients.length > 0;
      return {
        groups: [],
        heading: day.heading,
        message: filtered
          ? `No tasks for ${config.clients.join(", ")}.`
          : "No tasks.",
        showClientHeadings: false,
      };
    }

    return { groups, heading: day.heading, message: null, showClientHeadings };
  }

  /**
   * Render a model as a complete HTML document for a webview.
   *
   * @param model - What to show.
   * @param nonce - Per-render nonce, required by the content security policy.
   * @param cspSource - The webview's `cspSource`, which scopes style loading.
   * @returns An HTML document.
   */
  static html(model: PaneModel, nonce: string, cspSource: string): string {
    const body = model.message
      ? `<p class="empty">${Markdown.escapeHtml(model.message)}</p>`
      : model.groups
          .map((group) => {
            const title =
              model.showClientHeadings && group.client
                ? `<h2>${Markdown.escapeHtml(group.client)}</h2>`
                : "";
            const items = group.tasks
              .map(
                (task) =>
                  `<li class="${task.done ? "done" : "open"}">` +
                  `<input type="checkbox" disabled${task.done ? " checked" : ""} />` +
                  `<span>${Markdown.renderInline(task.text)}</span></li>`,
              )
              .join("");
            return `${title}<ul>${items}</ul>`;
          })
          .join("");

    const heading = model.heading
      ? `<p class="day">${Markdown.escapeHtml(model.heading)}</p>`
      : "";

    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'nonce-${nonce}'; font-src ${cspSource};" />
<style nonce="${nonce}">
  body {
    color: var(--vscode-foreground);
    font-family: var(--vscode-font-family);
    font-size: var(--vscode-font-size);
    padding: 4px 8px 10px;
  }
  .day {
    color: var(--vscode-descriptionForeground);
    font-size: 0.9em;
    margin: 2px 0 8px;
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }
  .empty {
    color: var(--vscode-descriptionForeground);
    font-style: italic;
  }
  h2 {
    color: var(--vscode-descriptionForeground);
    font-size: 0.85em;
    font-weight: 600;
    letter-spacing: 0.04em;
    margin: 10px 0 4px;
    text-transform: uppercase;
  }
  ul { list-style: none; margin: 0; padding: 0; }
  li {
    display: flex;
    gap: 6px;
    align-items: flex-start;
    padding: 3px 0;
    line-height: 1.45;
  }
  li + li { border-top: 1px solid var(--vscode-widget-border, transparent); }
  li.done span { color: var(--vscode-descriptionForeground); }
  li.done > span { text-decoration: line-through; }
  input[type="checkbox"] {
    margin: 3px 0 0;
    flex: 0 0 auto;
    accent-color: var(--vscode-checkbox-selectBackground);
  }
  a { color: var(--vscode-textLink-foreground); }
  code {
    background: var(--vscode-textCodeBlock-background);
    border-radius: 3px;
    font-family: var(--vscode-editor-font-family);
    font-size: 0.92em;
    padding: 0 3px;
  }
</style>
</head>
<body>${heading}${body}</body>
</html>`;
  }
}
