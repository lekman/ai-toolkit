import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { describe, expect, test } from "bun:test";

import { serve } from "../src/http.ts";
import {
  assertSafeBindHost,
  isTailnetAddress,
  UnsafeBindError,
} from "../src/tailnet.ts";
import { registerTaskTools, TOOL_NAMES } from "../src/tools.ts";
import { fixture } from "./setup.ts";

const TOKEN = "t".repeat(40);

async function inMemoryClient() {
  const ctx = await fixture();
  const server = new McpServer({ name: "atlas", version: "0.1.0" });
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
            by: "iviron",
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
          arguments: { by: "iviron", id: added.id },
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
    expect(refused.text).toContain("claimed by iviron");

    const stale = payload(
      await client.callTool({
        name: "task_update",
        arguments: { by: "iviron", id: added.id, revision: 1, state: "doing" },
      }),
    );
    expect(stale.isError).toBe(true);
    expect(stale.text).toContain("task_get");

    const updated = JSON.parse(
      payload(
        await client.callTool({
          name: "task_update",
          arguments: {
            by: "iviron",
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
        by: "iviron",
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
