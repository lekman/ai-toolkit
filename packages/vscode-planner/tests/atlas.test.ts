import { describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { FileDocStore, StdioToolHost } from "../src/atlas/atlas.system.ts";
import { Atlas } from "../src/atlas/atlas.ts";
import { Shim } from "../src/atlas/shim.ts";

const OPTIONS = {
  cspSource: "vscode-webview://x",
  nonce: "N0nce",
  storage: {},
};

describe("focusKey", () => {
  test("takes the first word of a single client, in lower case", () => {
    expect(Atlas.focusKey(["Acme Consulting"])).toBe("acme");
    expect(Atlas.focusKey(["GlobEx"])).toBe("globex");
  });

  test("is null for no client or several", () => {
    expect(Atlas.focusKey([])).toBeNull();
    expect(Atlas.focusKey(["Acme", "Globex"])).toBeNull();
  });
});

describe("hostServer", () => {
  const config = {
    mcpServers: {
      dashboard: {
        args: ["/srv/dashboard_mcp.py", 3],
        command: "/usr/bin/python3",
        env: { A: "1", B: 2 },
      },
    },
  };

  test("reads the named server", () => {
    expect(Atlas.hostServer(config, "dashboard")).toEqual({
      args: ["/srv/dashboard_mcp.py"],
      command: "/usr/bin/python3",
      env: { A: "1" },
    });
  });

  test("is null when the server or the config is missing", () => {
    expect(Atlas.hostServer(config, "other")).toBeNull();
    expect(Atlas.hostServer(null, "dashboard")).toBeNull();
    expect(
      Atlas.hostServer(
        { mcpServers: { dashboard: { args: [] } } },
        "dashboard",
      ),
    ).toBeNull();
  });
});

describe("page", () => {
  const html = Atlas.page(
    '<title>Atlas</title><script>run()</script><script nonce="kept">x()</script>',
    OPTIONS,
  );

  test("wraps the page in a document with a content security policy", () => {
    expect(html.startsWith("<!doctype html>")).toBe(true);
    expect(html).toContain("Content-Security-Policy");
    expect(html).toContain(
      "script-src 'nonce-N0nce' https://cdnjs.cloudflare.com",
    );
    expect(html).toContain("default-src 'none'");
  });

  test("gives every script without a nonce the nonce", () => {
    expect(html).toContain('<script nonce="N0nce">run()</script>');
    expect(html).toContain('<script nonce="kept">x()</script>');
  });

  test("runs the runtime stand-in before the page", () => {
    expect(html.indexOf("window.claude")).toBeLessThan(
      html.indexOf("run()</script>"),
    );
  });

  test("hides what the page marks hidden, as the artifact host does", () => {
    expect(html).toContain(
      "[hidden]:not([hidden=until-found i]){display:none!important}",
    );
  });

  test("drops the page's own doctype", () => {
    const again = Atlas.page("<!DOCTYPE html><p>x</p>", OPTIONS);
    expect(again.match(/<!doctype/gi)?.length).toBe(1);
  });
});

describe("shim", () => {
  test("fills in the saved storage", () => {
    expect(Shim.script({ "db.focus": "acme" })).toContain(
      'new Map(Object.entries({"db.focus":"acme"}))',
    );
  });

  test("cannot close its own script tag", () => {
    expect(Shim.script({ x: "</script>" })).not.toContain("</script>");
  });

  test("keeps a value with $ patterns as written", () => {
    expect(Shim.script({ x: "$&$'" })).toContain('{"x":"$&$\'"}');
  });

  // Runs the script against a stand-in window, with the extension's side
  // answered in the test, to check the calls the page makes end to end.
  test("answers the page's runtime calls through postMessage", async () => {
    const sent: Record<string, unknown>[] = [];
    let deliver: (data: unknown) => void = () => {};
    const window: Record<string, unknown> = {
      addEventListener: (_: string, fn: (e: { data: unknown }) => void) => {
        deliver = (data) => fn({ data });
      },
    };
    new Function(
      "window",
      "acquireVsCodeApi",
      Shim.script({ "db.focus": "acme" }),
    )(window, () => ({
      postMessage: (m: Record<string, unknown>) => sent.push(m),
    }));

    // localStorage reads the saved copy and sends each change back.
    const storage = window.localStorage as Storage;
    expect(storage.getItem("db.focus")).toBe("acme");
    storage.setItem("db.view", "agenda");
    storage.setItem("db.view", "agenda");
    storage.removeItem("db.focus");
    expect(storage.getItem("db.focus")).toBeNull();
    expect(storage.length).toBe(1);
    expect(sent.map(({ key, kind, value }) => ({ key, kind, value }))).toEqual([
      { key: "db.view", kind: "storageSet", value: "agenda" },
      { key: "db.focus", kind: "storageSet", value: null },
    ]);

    interface Snap {
      data: () => unknown;
      exists: boolean;
    }
    interface Runtime {
      doc: (path: string) => { onSnapshot: (fn: (s: Snap) => void) => void };
      callTool: (s: string, t: string, a: unknown) => Promise<unknown>;
      watchTool: (
        s: string,
        t: string,
        a: unknown,
        fn: (e: unknown) => void,
        o: { refetchInterval: number },
      ) => () => void;
    }
    const claude = window.claude as { use: (n: string) => Promise<Runtime> };
    await expect(claude.use("files")).rejects.toMatchObject({
      code: "not_granted",
    });
    const mcp = await claude.use("mcp");
    const db = await claude.use("db");

    const call = mcp.callTool("host:dashboard", "worklist", null);
    expect(sent.at(-1)).toMatchObject({
      args: {},
      kind: "callTool",
      tool: "worklist",
      type: "atlas",
    });
    deliver({
      id: sent.at(-1)!.id,
      ok: true,
      result: { structuredContent: 1 },
      type: "atlas:reply",
    });
    expect(await call).toEqual({ structuredContent: 1 });

    const seen: unknown[] = [];
    db.doc("board/tasks").onSnapshot((s) =>
      seen.push(s.exists ? s.data() : null),
    );
    deliver({
      id: sent.at(-1)!.id,
      ok: true,
      result: null,
      type: "atlas:reply",
    });
    await Promise.resolve();
    deliver({ data: { items: [1] }, path: "board/tasks", type: "atlas:doc" });
    expect(seen).toEqual([null, { items: [1] }]);

    const events: unknown[] = [];
    const stop = mcp.watchTool(
      "GitHub",
      "list_issues",
      {},
      (e: unknown) => events.push(e),
      {
        refetchInterval: 10,
      },
    );
    deliver({
      error: { code: "not_granted" },
      id: sent.at(-1)!.id,
      ok: false,
      type: "atlas:reply",
    });
    await new Promise((r) => setTimeout(r, 30));
    expect(events).toEqual([{ error: { code: "not_granted" }, type: "error" }]);
    // A connector that is not granted is not asked again.
    expect(sent.filter((m) => m.tool === "list_issues")).toHaveLength(1);
    stop();
  });
});

describe("request", () => {
  test("accepts a tool call and defaults its arguments", () => {
    expect(
      Atlas.request({
        id: 1,
        kind: "callTool",
        server: "host:dashboard",
        tool: "worklist",
        type: "atlas",
      }),
    ).toEqual({
      args: {},
      id: 1,
      kind: "callTool",
      server: "host:dashboard",
      tool: "worklist",
    });
  });

  test("accepts store calls on paths the page writes", () => {
    expect(
      Atlas.request({
        id: 2,
        kind: "dbGet",
        path: "board/tasks",
        type: "atlas",
      }),
    ).toEqual({
      id: 2,
      kind: "dbGet",
      path: "board/tasks",
    });
    expect(
      Atlas.request({
        data: { a: 1 },
        id: 3,
        kind: "dbSet",
        path: "prs/clients-acme-x.y",
        type: "atlas",
      }),
    ).toEqual({
      data: { a: 1 },
      id: 3,
      kind: "dbSet",
      path: "prs/clients-acme-x.y",
    });
  });

  test("refuses anything else", () => {
    const bad = [
      null,
      "x",
      { id: 1, kind: "dbGet", path: "board/tasks" },
      { id: 0, kind: "dbGet", path: "board/tasks", type: "atlas" },
      { id: 1.5, kind: "dbGet", path: "board/tasks", type: "atlas" },
      { id: 1, kind: "dbGet", path: "../secrets", type: "atlas" },
      { id: 1, kind: "dbGet", path: "board/../x", type: "atlas" },
      { id: 1, kind: "dbGet", path: "/etc/passwd", type: "atlas" },
      { id: 1, kind: "dbGet", path: "a b", type: "atlas" },
      { id: 1, kind: "exec", path: "board/tasks", type: "atlas" },
      {
        args: [1],
        id: 1,
        kind: "callTool",
        server: "host:dashboard",
        tool: "x",
        type: "atlas",
      },
      { id: 1, kind: "callTool", server: "", tool: "x", type: "atlas" },
    ];
    for (const message of bad) expect(Atlas.request(message)).toBeNull();
  });
});

describe("storage", () => {
  test("accepts the page's storage writes and removals", () => {
    expect(
      Atlas.request({
        id: 1,
        key: "db.view",
        kind: "storageSet",
        type: "atlas",
        value: "agenda",
      }),
    ).toEqual({
      id: 1,
      key: "db.view",
      kind: "storageSet",
      value: "agenda",
    });
    expect(
      Atlas.request({
        id: 1,
        key: "db.focus",
        kind: "storageSet",
        type: "atlas",
        value: null,
      }),
    ).toMatchObject({
      value: null,
    });
  });

  test("refuses odd keys and values", () => {
    for (const bad of [
      { key: "a b", value: "x" },
      { key: "", value: "x" },
      { key: "db.view", value: 3 },
      { key: "db.view", value: "x".repeat(100_001) },
    ]) {
      expect(
        Atlas.request({ id: 1, kind: "storageSet", type: "atlas", ...bad }),
      ).toBeNull();
    }
  });

  test("keeps the chosen client per workspace and the rest for every window", () => {
    expect(Atlas.storageScope("db.focus")).toBe("workspace");
    expect(Atlas.storageScope("db.view")).toBe("global");
  });

  test("opens on this workspace's choice, then the repository's client, then the last choice", () => {
    const global = { "db.focus": "globex", "db.view": "agenda" };
    expect(Atlas.storageSnapshot(global, "initech", "acme")).toEqual({
      "db.focus": "initech",
      "db.view": "agenda",
    });
    expect(Atlas.storageSnapshot(global, null, "acme")["db.focus"]).toBe(
      "acme",
    );
    expect(Atlas.storageSnapshot(global, null, null)["db.focus"]).toBe(
      "globex",
    );
    expect(Atlas.storageSnapshot({}, null, null)).toEqual({});
  });
});

describe("toolOutcome", () => {
  test("passes a result through", () => {
    const result = { content: [], structuredContent: { items: [] } };
    expect(Atlas.toolOutcome(result)).toEqual({ result });
  });

  test("fails a result marked as an error, with the tool's text", () => {
    expect(
      Atlas.toolOutcome({
        content: [{ text: "Release check failed", type: "text" }],
        isError: true,
      }),
    ).toEqual({
      error: { code: "tool_error", message: "Release check failed" },
    });
  });

  test("answers only host:dashboard; other servers are not granted", () => {
    expect(Atlas.isHost("host:dashboard")).toBe(true);
    expect(Atlas.isHost("GitHub")).toBe(false);
    expect(Atlas.notGranted("GitHub").code).toBe("not_granted");
  });
});

describe("FileDocStore", () => {
  test("keeps documents across instances", () => {
    const path = join(mkdtempSync(join(tmpdir(), "atlas-")), "store.json");
    const store = new FileDocStore(path);
    expect(store.get("board/tasks")).toBeNull();
    store.set("board/tasks", { items: [1] });
    expect(new FileDocStore(path).get("board/tasks")).toEqual({ items: [1] });
    store.delete("board/tasks");
    expect(new FileDocStore(path).get("board/tasks")).toBeNull();
  });
});

describe("StdioToolHost", () => {
  // A server that speaks the same newline-delimited JSON-RPC as the real one.
  const dir = mkdtempSync(join(tmpdir(), "atlas-server-"));
  const script = join(dir, "server.ts");
  writeFileSync(
    script,
    `for await (const line of console) {
  const m = JSON.parse(line);
  if (m.id === undefined) continue;
  const result = m.method === "initialize" ? { protocolVersion: "2025-06-18" }
    : m.params.name === "fail" ? undefined
    : { content: [], structuredContent: { echo: m.params.arguments } };
  const reply = result ? { jsonrpc: "2.0", id: m.id, result } : { jsonrpc: "2.0", id: m.id, error: { code: -32603, message: "boom" } };
  process.stdout.write(JSON.stringify(reply) + "\\n");
}`,
  );

  test("starts the server and calls a tool", async () => {
    const host = new StdioToolHost({
      args: [script],
      command: process.execPath,
    });
    try {
      expect(await host.callTool("worklist", { a: 1 })).toEqual({
        content: [],
        structuredContent: { echo: { a: 1 } },
      });
      await expect(host.callTool("fail", {})).rejects.toEqual({
        code: "tool_error",
        message: "boom",
      });
    } finally {
      host.dispose();
    }
  });

  test("fails with server_not_connected when nothing is configured or it cannot start", async () => {
    await expect(
      new StdioToolHost(null).callTool("worklist", {}),
    ).rejects.toMatchObject({
      code: "server_not_connected",
    });
    const host = new StdioToolHost({ args: [], command: join(dir, "missing") });
    await expect(host.callTool("worklist", {})).rejects.toMatchObject({
      code: "server_not_connected",
    });
  });
});
