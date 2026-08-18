import { describe, expect, test } from "bun:test";

import { Indexer } from "../src/indexer";
import {
  assertSafeBindHost,
  isTailnetAddress,
  McpHttpServer,
  SEARCH_TOOL_NAMES,
  UnsafeBindError,
} from "../src/mcp";
import { EmbeddingsMock } from "./mocks/embeddings.mock";
import { ReaderMock } from "./mocks/reader.mock";
import { StoreMock } from "./mocks/store.mock";

const NOTE = `---\ntype: note\nclient: AcmeCo\n---\n## Pricing\n\nAcmeCo prefers fixed-price milestones.\n`;

/** A store with one indexed note, plus the mocks the server needs. */
const setup = async () => {
  const reader = new ReaderMock();
  const store = new StoreMock();
  const embeddings = new EmbeddingsMock();
  reader.set("Clients/AcmeCo/Commercials.md", NOTE, 100);
  await Indexer.scan(reader, store, embeddings);
  return { embeddings, store };
};

/** One JSON-RPC call over the streamable-HTTP transport. */
const rpc = async (
  base: string,
  method: string,
  params: Record<string, unknown> = {},
): Promise<Record<string, unknown>> => {
  const response = await fetch(base, {
    body: JSON.stringify({ id: 1, jsonrpc: "2.0", method, params }),
    headers: {
      accept: "application/json, text/event-stream",
      "content-type": "application/json",
    },
    method: "POST",
  });
  const text = await response.text();
  // The transport may answer as SSE; take the last data: line either way.
  const line = text
    .split("\n")
    .filter((row) => row.startsWith("data:"))
    .pop();
  return JSON.parse(line ? line.slice(5).trim() : text) as Record<
    string,
    unknown
  >;
};

/** Start the server on loopback for the duration of one test. */
const withServer = async (
  run: (base: string) => Promise<void>,
): Promise<void> => {
  const { embeddings, store } = await setup();
  const server = await McpHttpServer.serve(store, embeddings, {
    host: "127.0.0.1",
    port: 0,
  });
  try {
    await run(`http://127.0.0.1:${String(server.address.port)}/`);
  } finally {
    await server.close();
  }
};

// ── The bind guard ───────────────────────────────────────────────────
//
// This is the control that keeps the index off the LAN. A functional test
// cannot catch a wildcard bind — everything still works, it just works for
// everyone — so it is asserted directly.

describe("assertSafeBindHost", () => {
  test.each([["0.0.0.0"], ["::"], ["[::]"], ["*"], [""], ["  "]])(
    "refuses the wildcard %p",
    (host) => {
      expect(() => assertSafeBindHost(host)).toThrow(UnsafeBindError);
    },
  );

  test.each([["127.0.0.1"], ["100.118.166.65"], ["192.168.0.10"]])(
    "allows the specific address %p",
    (host) => {
      expect(() => assertSafeBindHost(host)).not.toThrow();
    },
  );

  test("the server refuses to listen on a wildcard, it does not merely warn", async () => {
    const { embeddings, store } = await setup();
    await expect(
      McpHttpServer.serve(store, embeddings, { host: "0.0.0.0", port: 0 }),
    ).rejects.toThrow(UnsafeBindError);
  });
});

describe("isTailnetAddress", () => {
  test.each([["100.64.0.1"], ["100.118.166.65"], ["100.127.255.254"]])(
    "%p is inside 100.64.0.0/10",
    (address) => {
      expect(isTailnetAddress(address)).toBe(true);
    },
  );

  // 100.63.x and 100.128.x sit just outside the CGNAT range and are the
  // off-by-one that would let a non-tailnet interface be chosen.
  test.each([
    ["100.63.255.255"],
    ["100.128.0.0"],
    ["192.168.0.1"],
    ["10.0.0.1"],
    ["not-an-ip"],
    ["100.64.0"],
  ])("%p is outside", (address) => {
    expect(isTailnetAddress(address)).toBe(false);
  });
});

// ── The served surface ───────────────────────────────────────────────

describe("McpHttpServer", () => {
  test("binds to exactly the address it was given", async () => {
    const { embeddings, store } = await setup();
    const server = await McpHttpServer.serve(store, embeddings, {
      host: "127.0.0.1",
      port: 0,
    });
    expect(server.address.host).toBe("127.0.0.1");
    expect(server.address.port).toBeGreaterThan(0);
    await server.close();
  });

  test("exposes exactly the three read-only tools, and nothing that writes", async () => {
    await withServer(async (base) => {
      await rpc(base, "initialize", {
        capabilities: {},
        clientInfo: { name: "test", version: "0" },
        protocolVersion: "2025-06-18",
      });
      const listed = await rpc(base, "tools/list");
      const result = listed["result"] as { tools: { name: string }[] };
      const names = result.tools.map((tool) => tool.name).sort();
      expect(names).toEqual([...SEARCH_TOOL_NAMES].sort());
    });
  });

  test("search_notes answers from the store through SearchHandlers", async () => {
    await withServer(async (base) => {
      await rpc(base, "initialize", {
        capabilities: {},
        clientInfo: { name: "test", version: "0" },
        protocolVersion: "2025-06-18",
      });
      const called = await rpc(base, "tools/call", {
        arguments: { query: "fixed-price milestones" },
        name: "search_notes",
      });
      const result = called["result"] as { content: { text: string }[] };
      const hits = JSON.parse(result.content[0]?.text ?? "[]") as {
        path: string;
      }[];
      expect(hits.length).toBeGreaterThan(0);
      expect(hits[0]?.path).toBe("Clients/AcmeCo/Commercials.md");
    });
  });

  test("get_note reassembles a note, and reports a miss rather than throwing", async () => {
    await withServer(async (base) => {
      await rpc(base, "initialize", {
        capabilities: {},
        clientInfo: { name: "test", version: "0" },
        protocolVersion: "2025-06-18",
      });
      const hit = await rpc(base, "tools/call", {
        arguments: { path: "Clients/AcmeCo/Commercials.md" },
        name: "get_note",
      });
      const hitResult = hit["result"] as { content: { text: string }[] };
      expect(hitResult.content[0]?.text).toContain("fixed-price milestones");

      const miss = await rpc(base, "tools/call", {
        arguments: { path: "Nope.md" },
        name: "get_note",
      });
      const missResult = miss["result"] as { content: { text: string }[] };
      expect(missResult.content[0]?.text).toContain("not indexed");
    });
  });
});
