import { describe, expect, test } from "bun:test";

import * as messages from "../src/messages.ts";
import { fixture } from "./setup.ts";

describe("messages", () => {
  test("a message takes its client's classification and is read by its recipient", async () => {
    const ctx = await fixture();
    const sent = await messages.send(
      ctx,
      "Laptop Agent",
      "Commander",
      "acme",
      "Done with 1.1",
    );
    expect(sent.id).toMatch(/^[0-9a-z]{26}$/);
    const [row] = await messages.inbox(ctx, { to: "commander" });
    expect(row).toMatchObject({
      id: sent.id,
      clientId: "acme",
      from: "laptop-agent",
      to: "commander",
      text: "Done with 1.1",
      createdAt: "2026-10-24T09:00:00Z",
    });
    expect(row?.deliveredAt).toBeUndefined();
    const [stored] = await ctx.pg
      .query<{ classification: string; boundary: string }>(
        "SELECT classification, boundary FROM message",
      )
      .then((r) => r.rows);
    expect(stored).toEqual({
      classification: "client-confidential",
      boundary: "acme",
    });
  });

  test("delivered stamps once, and undelivered leaves those out", async () => {
    const ctx = await fixture();
    const a = await messages.send(ctx, "a", "lekman", "acme", "one");
    const b = await messages.send(ctx, "a", "lekman", "acme", "two");
    expect(await messages.delivered(ctx, "commander", [a.id])).toEqual([a.id]);
    expect(await messages.delivered(ctx, "commander", [a.id])).toEqual([]);
    const open = await messages.inbox(ctx, { undelivered: true });
    expect(open.map((m) => m.id)).toEqual([b.id]);
    const [first] = await messages.inbox(ctx, { to: "lekman" });
    expect(first).toMatchObject({ id: a.id, deliveredBy: "commander" });
  });

  test("a scoped caller sends and reads only its clients' messages", async () => {
    const ctx = await fixture();
    await messages.send(ctx, "a", "lekman", "globex", "about globex");
    const scoped = { ...ctx, scope: ["acme"] };
    await messages.send(scoped, "laptop", "lekman", "acme", "about acme");
    expect(
      messages.send(scoped, "laptop", "lekman", "globex", "x"),
    ).rejects.toThrow(/no client globex/);
    const seen = await messages.inbox(scoped, { to: "lekman" });
    expect(seen.map((m) => m.text)).toEqual(["about acme"]);
    const all = await messages.inbox(ctx, { to: "lekman" });
    const globex = all.find((m) => m.clientId === "globex");
    expect(await messages.delivered(scoped, "laptop", [globex!.id])).toEqual(
      [],
    );
  });

  test("an unknown client is refused", async () => {
    const ctx = await fixture();
    expect(messages.send(ctx, "a", "b", "nobody", "x")).rejects.toThrow(
      /no client nobody/,
    );
  });
});
