import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";

import { parseScopedTokens, serve } from "../src/http.ts";
import {
  assertSafeBindHost,
  isTailnetAddress,
  UnsafeBindError,
} from "../src/tailnet.ts";
import * as tasks from "../src/tasks.ts";
import { registerTaskTools, TOOL_NAMES } from "../src/tools.ts";
import { fixture } from "./setup.ts";

const TOKEN = "t".repeat(40);

async function inMemoryClient() {
  const ctx = await fixture();
  const server = new McpServer({ name: "tasks", version: "0.1.0" });
  registerTaskTools(server, ctx);
  const [a, b] = InMemoryTransport.createLinkedPair();
  await server.connect(a);
  const client = new Client({ name: "test", version: "0" });
  await client.connect(b);
  return client;
}

function payload(result: Awaited<ReturnType<Client["callTool"]>>) {
  const first = (result.content as { text: string }[])[0]!;
  return { isError: result.isError === true, text: first.text };
}

describe("tools", () => {
  test("the registered surface is exactly TOOL_NAMES", async () => {
    const client = await inMemoryClient();
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name)).toEqual([...TOOL_NAMES]);
  });

  test("an agent adds, claims, updates and completes an item", async () => {
    const client = await inMemoryClient();
    const added = JSON.parse(
      payload(
        await client.callTool({
          name: "task_add",
          arguments: {
            by: "builder",
            clientId: "acme",
            title: "Ship it",
            effort: "S",
            businessValue: "high",
          },
        }),
      ).text,
    );
    const claimed = JSON.parse(
      payload(
        await client.callTool({
          name: "task_claim",
          arguments: { by: "builder", id: added.id },
        }),
      ).text,
    );
    const refused = payload(
      await client.callTool({
        name: "task_claim",
        arguments: { by: "commander", id: added.id },
      }),
    );
    expect(refused.isError).toBe(true);
    expect(refused.text).toContain("claimed by builder");

    const stale = payload(
      await client.callTool({
        name: "task_update",
        arguments: { by: "builder", id: added.id, revision: 1, state: "doing" },
      }),
    );
    expect(stale.isError).toBe(true);
    expect(stale.text).toContain("task_get");

    const updated = JSON.parse(
      payload(
        await client.callTool({
          name: "task_update",
          arguments: {
            by: "builder",
            id: added.id,
            revision: claimed.revision,
            state: "doing",
            note: "started",
          },
        }),
      ).text,
    );
    await client.callTool({
      name: "task_complete",
      arguments: {
        by: "builder",
        id: added.id,
        revision: updated.revision,
        note: "done",
      },
    });
    const read = JSON.parse(
      payload(
        await client.callTool({
          name: "task_get",
          arguments: { id: added.id },
        }),
      ).text,
    );
    expect(read.state).toBe("done");
    expect(read.history.map((h: { kind: string }) => h.kind)).toEqual([
      "added",
      "claimed",
      "state",
      "state",
    ]);
  });

  test("bad input is refused before it reaches the database", async () => {
    const client = await inMemoryClient();
    const result = await client.callTool({
      name: "task_update",
      arguments: { by: "x", id: "Not An Id", revision: 1 },
    });
    expect(result.isError).toBe(true);
  });
});

describe("http", () => {
  test("refuses a wildcard bind and a short token", async () => {
    expect(() => assertSafeBindHost("0.0.0.0")).toThrow(UnsafeBindError);
    expect(isTailnetAddress("100.118.166.65")).toBe(true);
    expect(isTailnetAddress("192.168.1.10")).toBe(false);
    const ctx = await fixture();
    await expect(
      serve(ctx, { host: "127.0.0.1", port: 0, token: "short" }),
    ).rejects.toThrow(/at least 32/);
  });

  test("needs the bearer token, then serves the tools", async () => {
    const ctx = await fixture();
    const running = await serve(ctx, {
      host: "127.0.0.1",
      port: 0,
      token: TOKEN,
    });
    const base = `http://127.0.0.1:${running.address.port}`;
    try {
      expect((await fetch(`${base}/health`)).status).toBe(200);
      const anonymous = await fetch(`${base}/mcp`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json, text/event-stream",
        },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
      });
      expect(anonymous.status).toBe(401);
      const wrong = await fetch(`${base}/mcp`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${"x".repeat(40)}`,
          "content-type": "application/json",
        },
        body: "{}",
      });
      expect(wrong.status).toBe(401);

      const client = new Client({ name: "test", version: "0" });
      await client.connect(
        new StreamableHTTPClientTransport(new URL(`${base}/mcp`), {
          requestInit: { headers: { authorization: `Bearer ${TOKEN}` } },
        }),
      );
      const { tools } = await client.listTools();
      expect(tools).toHaveLength(TOOL_NAMES.length);
      const listed = await client.callTool({
        name: "client_list",
        arguments: {},
      });
      expect(payload(listed).text).toContain("acme-delivery");
      await client.close();
    } finally {
      await running.close();
    }
  });
});

describe("scoped tokens", () => {
  const SCOPED = "s".repeat(40);
  const sha = createHash("sha256").update(SCOPED).digest("hex");

  test("the token file is checked before the server starts", () => {
    expect(
      parseScopedTokens(
        JSON.stringify([{ name: "laptop", sha256: sha, clients: ["acme"] }]),
      ),
    ).toHaveLength(1);
    expect(() =>
      parseScopedTokens(
        JSON.stringify([{ name: "laptop", sha256: "abc", clients: ["acme"] }]),
      ),
    ).toThrow(/64-hex/);
    expect(() =>
      parseScopedTokens(
        JSON.stringify([{ name: "laptop", sha256: sha, clients: [] }]),
      ),
    ).toThrow();
    expect(() => parseScopedTokens("{}")).toThrow(/array/);
  });

  test("a scoped token sees and changes only its clients; the main token sees all", async () => {
    const ctx = await fixture();
    const mine = await tasks.add(ctx, "a", "acme", { title: "Acme work" });
    const theirs = await tasks.add(ctx, "a", "globex", {
      title: "Globex work",
    });
    const running = await serve(ctx, {
      host: "127.0.0.1",
      port: 0,
      scopedTokens: [{ name: "laptop", sha256: sha, clients: ["acme"] }],
      token: TOKEN,
    });
    const connect = async (token: string) => {
      const client = new Client({ name: "test", version: "0" });
      await client.connect(
        new StreamableHTTPClientTransport(
          new URL(`http://127.0.0.1:${running.address.port}/mcp`),
          {
            requestInit: { headers: { authorization: `Bearer ${token}` } },
          },
        ),
      );
      return client;
    };
    const call = async (
      client: Client,
      name: string,
      args: Record<string, unknown>,
    ) => payload(await client.callTool({ name, arguments: args }));
    try {
      const scoped = await connect(SCOPED);
      expect(
        JSON.parse((await call(scoped, "client_list", {})).text).map(
          (c: { id: string }) => c.id,
        ),
      ).toEqual(["acme"]);
      const found = JSON.parse((await call(scoped, "task_search", {})).text);
      expect(found.items.map((i: { id: string }) => i.id)).toEqual([mine.id]);
      expect(
        JSON.parse(
          (await call(scoped, "task_search", { clientId: "globex" })).text,
        ).count,
      ).toBe(0);
      const hidden = await call(scoped, "task_get", { id: theirs.id });
      expect(hidden.isError).toBe(true);
      expect(hidden.text).toContain("no item");
      expect(
        (await call(scoped, "task_claim", { by: "laptop", id: theirs.id }))
          .isError,
      ).toBe(true);
      expect(
        (
          await call(scoped, "task_log", {
            by: "laptop",
            id: theirs.id,
            status: "doing",
            note: "x",
          })
        ).isError,
      ).toBe(true);
      expect(
        (
          await call(scoped, "task_add", {
            by: "laptop",
            clientId: "globex",
            title: "x",
          })
        ).text,
      ).toContain("no client globex");
      expect(
        (await call(scoped, "task_claim", { by: "laptop", id: mine.id }))
          .isError,
      ).toBe(false);
      await scoped.close();

      const full = await connect(TOKEN);
      expect(
        JSON.parse((await call(full, "client_list", {})).text),
      ).toHaveLength(2);
      expect(JSON.parse((await call(full, "task_search", {})).text).count).toBe(
        2,
      );
      await full.close();

      const anonymous = await fetch(
        `http://127.0.0.1:${running.address.port}/mcp`,
        {
          method: "POST",
          headers: {
            authorization: `Bearer ${"z".repeat(40)}`,
            "content-type": "application/json",
          },
          body: "{}",
        },
      );
      expect(anonymous.status).toBe(401);
    } finally {
      await running.close();
    }
  });
});
