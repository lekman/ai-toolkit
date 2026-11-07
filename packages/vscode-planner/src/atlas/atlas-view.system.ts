/** VS Code webview adapters for the Atlas page: the sidebar view and task details tabs. */

import { randomBytes } from "node:crypto";
import * as vscode from "vscode";

import type { IConnectors } from "../connectors/index.ts";
import type { IDocStore, IPageStorage, IToolHost } from "./interfaces.ts";
import type { AtlasMode, AtlasRequest, RuntimeError } from "./types.ts";

import { Atlas } from "./atlas.ts";

/** What the provider needs at render time. */
export interface AtlasState {
  /** The repository's client key, used until a client is chosen here. */
  focus: null | string;
  /** Absolute path to the page, for the message when it cannot be read. */
  pagePath: null | string;
  /** The page source, or null when it could not be read. */
  source: null | string;
}

/**
 * Answers the runtime calls of every webview that hosts the Atlas page.
 *
 * The sidebar and each details tab run their own copy of the page, but they
 * share one data store, so a write from one is announced to all of them.
 */
export class AtlasBridge {
  private readonly webviews = new Set<vscode.Webview>();

  /**
   * @param host - Answers `host:dashboard` tool calls.
   * @param store - The page's data store.
   * @param connectors - Answers connector calls with direct API requests.
   * @param pageStorage - Keeps the page's `localStorage` across reloads.
   * @param openDetails - Opens a task's details in an editor tab.
   */
  constructor(
    private readonly host: IToolHost,
    private readonly store: IDocStore,
    private readonly connectors: IConnectors,
    private readonly pageStorage: IPageStorage,
    private readonly openDetails: (ref: string) => void,
  ) {}

  /**
   * Answer a webview's runtime calls until it is disposed.
   *
   * @param webview - The webview to answer.
   * @returns Stops answering it.
   */
  attach(webview: vscode.Webview): vscode.Disposable {
    this.webviews.add(webview);
    const listening = webview.onDidReceiveMessage((message: unknown) => {
      const request = Atlas.request(message);
      if (request) void this.answer(webview, request);
    });
    return new vscode.Disposable(() => {
      listening.dispose();
      this.webviews.delete(webview);
    });
  }

  /**
   * The page's HTML for a webview.
   *
   * @param state - The page at render time.
   * @param webview - The webview it renders in.
   * @param mode - Set for a task's details tab.
   * @returns The HTML, or a short note when the page cannot be read.
   */
  html(state: AtlasState, webview: vscode.Webview, mode?: AtlasMode): string {
    const { pagePath, source } = state;
    if (source === null) {
      return `<!doctype html><meta charset="utf-8"><body style="font-family:var(--vscode-font-family);padding:8px 12px">Could not read the Atlas page${
        pagePath ? ` at <code>${escapeHtml(pagePath)}</code>` : ""
      }. Set <code>planner.atlasPage</code>.</body>`;
    }
    return Atlas.page(source, {
      cspSource: webview.cspSource,
      ...(mode ? { mode } : {}),
      nonce: randomBytes(16).toString("base64"),
      storage: this.pageStorage.snapshot(),
    });
  }

  /** @returns The page's stored worklist, for naming a details tab. */
  worklist(): unknown {
    return this.store.get("board/tasks");
  }

  private announce(path: string, data: unknown): void {
    for (const webview of this.webviews) {
      void webview.postMessage({ data, path, type: "atlas:doc" });
    }
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

    // The page does not wait for a storage write, so it gets no reply.
    if (request.kind === "storageSet") {
      this.pageStorage.set(request.key, request.value);
      return;
    }

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
          this.announce(request.path, null);
          return;
        case "dbGet":
          reply({ result: this.store.get(request.path) });
          return;
        case "dbSet":
          this.store.set(request.path, request.data);
          reply({ result: null });
          this.announce(request.path, request.data);
          return;
        case "openDetails":
          this.openDetails(request.ref);
          reply({ result: null });
          return;
      }
    } catch (error) {
      reply({ error: asRuntimeError(error) });
    }
  }
}

/** Hosts the Atlas page in the sidebar view. */
export class AtlasViewProvider implements vscode.WebviewViewProvider {
  private view: undefined | vscode.WebviewView;

  /**
   * @param getState - Returns the page at render time.
   * @param bridge - Answers the page's runtime calls.
   */
  constructor(
    private readonly getState: () => AtlasState,
    private readonly bridge: AtlasBridge,
  ) {}

  /** Re-render the page from current state. Safe before the view exists. */
  render(): void {
    if (!this.view) return;
    this.view.webview.html = this.bridge.html(
      this.getState(),
      this.view.webview,
    );
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
    const attached = this.bridge.attach(webviewView.webview);
    webviewView.onDidDispose(() => attached.dispose());
    this.render();
  }
}

/** Opens a task's details as a tab in the editor area, one tab per task. */
export class AtlasDetailsTabs implements vscode.Disposable {
  private readonly tabs = new Map<string, vscode.WebviewPanel>();

  /**
   * @param getState - Returns the page at render time.
   * @param bridge - Answers the page's runtime calls.
   */
  constructor(
    private readonly getState: () => AtlasState,
    private readonly bridge: AtlasBridge,
  ) {}

  /** Close every open details tab. */
  dispose(): void {
    for (const tab of [...this.tabs.values()]) tab.dispose();
  }

  /**
   * Show a task's details, in its open tab when it has one.
   *
   * @param ref - The task's ref.
   */
  open(ref: string): void {
    const open = this.tabs.get(ref);
    if (open) {
      open.reveal();
      return;
    }
    const tab = vscode.window.createWebviewPanel(
      "planner.atlasDetails",
      Atlas.detailsTitle(this.bridge.worklist(), ref),
      vscode.ViewColumn.Active,
      {
        enableScripts: true,
        localResourceRoots: [],
        // The page keeps its own timers; a hidden tab keeps its place.
        retainContextWhenHidden: true,
      },
    );
    tab.iconPath = new vscode.ThemeIcon("tasklist");
    const attached = this.bridge.attach(tab.webview);
    tab.onDidDispose(() => {
      attached.dispose();
      this.tabs.delete(ref);
    });
    this.tabs.set(ref, tab);
    this.render(ref);
  }

  /** Re-render every open tab, after the page or its server changed. */
  renderAll(): void {
    for (const ref of this.tabs.keys()) this.render(ref);
  }

  private render(ref: string): void {
    const tab = this.tabs.get(ref);
    if (!tab) return;
    tab.title = Atlas.detailsTitle(this.bridge.worklist(), ref);
    tab.webview.html = this.bridge.html(this.getState(), tab.webview, {
      ref,
      view: "details",
    });
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
