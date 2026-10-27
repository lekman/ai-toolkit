/** VS Code webview adapter for the Atlas view. */

import { randomBytes } from "node:crypto";
import * as vscode from "vscode";

import type { IConnectors } from "../connectors/index.ts";
import type { IDocStore, IToolHost } from "./interfaces.ts";
import type { AtlasRequest, RuntimeError } from "./types.ts";

import { Atlas } from "./atlas.ts";

/** What the provider needs at render time. */
export interface AtlasState {
  /** The page's client key to open on, or null. */
  focus: null | string;
  /** Absolute path to the page, for the message when it cannot be read. */
  pagePath: null | string;
  /** The page source, or null when it could not be read. */
  source: null | string;
}

/** Hosts the Atlas page in a webview view and answers its runtime calls. */
export class AtlasViewProvider implements vscode.WebviewViewProvider {
  private view: undefined | vscode.WebviewView;

  /**
   * @param getState - Returns the page and focus at render time.
   * @param host - Answers `host:dashboard` tool calls.
   * @param store - The page's data store.
   * @param connectors - Answers connector calls with direct API requests.
   */
  constructor(
    private readonly getState: () => AtlasState,
    private readonly host: IToolHost,
    private readonly store: IDocStore,
    private readonly connectors: IConnectors,
  ) {}

  /** Re-render the page from current state. Safe before the view exists. */
  render(): void {
    if (!this.view) return;
    const { focus, pagePath, source } = this.getState();
    const webview = this.view.webview;
    if (source === null) {
      webview.html = `<!doctype html><meta charset="utf-8"><body style="font-family:var(--vscode-font-family);padding:8px 12px">Could not read the Atlas page${
        pagePath ? ` at <code>${escapeHtml(pagePath)}</code>` : ""
      }. Set <code>planner.atlasPage</code>.</body>`;
      return;
    }
    webview.html = Atlas.page(source, {
      cspSource: webview.cspSource,
      focus,
      nonce: randomBytes(16).toString("base64"),
    });
  }

  /**
   * Called by VS Code when the view first becomes visible.
   *
   * @param webviewView - The view to populate.
   */
  resolveWebviewView(webviewView: vscode.WebviewView): void {
    this.view = webviewView;
    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [],
    };
    webviewView.webview.onDidReceiveMessage((message: unknown) => {
      const request = Atlas.request(message);
      if (request) void this.answer(webviewView.webview, request);
    });
    this.render();
  }

  private async answer(
    webview: vscode.Webview,
    request: AtlasRequest,
  ): Promise<void> {
    const reply = (body: { error: RuntimeError } | { result: unknown }) =>
      void webview.postMessage({
        id: request.id,
        type: "atlas:reply",
        ...("error" in body
          ? { error: body.error, ok: false }
          : { ok: true, result: body.result }),
      });

    try {
      switch (request.kind) {
        case "callTool": {
          if (!Atlas.isHost(request.server)) {
            const direct = this.connectors.call(
              request.server,
              request.tool,
              request.args,
            );
            reply(
              direct
                ? { result: await direct }
                : { error: Atlas.notGranted(request.server) },
            );
            return;
          }
          const result = await this.host.callTool(request.tool, request.args);
          reply(Atlas.toolOutcome(result));
          return;
        }
        case "dbDelete":
          this.store.delete(request.path);
          reply({ result: null });
          void webview.postMessage({
            data: null,
            path: request.path,
            type: "atlas:doc",
          });
          return;
        case "dbGet":
          reply({ result: this.store.get(request.path) });
          return;
        case "dbSet":
          this.store.set(request.path, request.data);
          reply({ result: null });
          void webview.postMessage({
            data: request.data,
            path: request.path,
            type: "atlas:doc",
          });
          return;
      }
    } catch (error) {
      reply({ error: asRuntimeError(error) });
    }
  }
}

function asRuntimeError(error: unknown): RuntimeError {
  if (typeof error === "object" && error !== null && "code" in error) {
    const { code, message } = error as { code: unknown; message?: unknown };
    if (typeof code === "string") {
      return { code, ...(typeof message === "string" ? { message } : {}) };
    }
  }
  return { code: "upstream_error", message: String(error) };
}

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}
