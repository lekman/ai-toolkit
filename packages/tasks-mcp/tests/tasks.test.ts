import { ClaimConflict, RevisionConflict } from "@lekman/dashboard-schema/db";
import { InvalidItem } from "@lekman/dashboard-schema/validate";
import { describe, expect, test } from "bun:test";

import * as tasks from "../src/tasks.ts";
import { fixture } from "./setup.ts";

describe("add", () => {
  test("a new item takes its client's classification and boundary, and a ULID", async () => {
    const ctx = await fixture();
    const item = await tasks.add(ctx, "builder", "acme", {
      title: "Rotate the deploy key",
      workstreamId: "acme-delivery",
      businessValue: "medium",
      effort: "XS",
    });
    expect(item.id).toMatch(/^[0-9a-z]{26}$/);
    expect(item.classification).toBe("client-confidential");
    expect(item.boundary).toBe("acme");
    const read = await tasks.read(ctx, item.id);
    expect(read.history).toEqual([
      {
        kind: "added",
        on: "2026-10-24",
        at: "2026-10-24T09:00:00Z",
        by: "builder",
      },
    ]);
    expect(read.assessment.priority).toBe("high");
  });

  test("a workstream of another client is refused", async () => {
    const ctx = await fixture();
    await expect(
      tasks.add(ctx, "builder", "acme", {
        title: "x",
        workstreamId: "globex-ops",
      }),
    ).rejects.toThrow();
  });

  test("an unknown client is refused", async () => {
    const ctx = await fixture();
    await expect(
      tasks.add(ctx, "builder", "nobody", { title: "x" }),
    ).rejects.toThrow(/no client nobody/);
  });

  test("blocked details without blocked are dropped, not stored", async () => {
    const ctx = await fixture();
    const item = await tasks.add(ctx, "builder", "acme", {
      title: "x",
      blockedOn: { since: "2026-10-24", waitingFor: "the token" },
    });
    expect(item.blockedOn).toBeUndefined();
  });
});

describe("search", () => {
  test("open items, most important first, with the computed priority", async () => {
    const ctx = await fixture();
    const low = await tasks.add(ctx, "a", "acme", {
      title: "Tidy",
      businessValue: "low",
      effort: "XS",
    });
    const high = await tasks.add(ctx, "a", "acme", {
      title: "Ship",
      businessValue: "high",
      effort: "S",
    });
    const done = await tasks.add(ctx, "a", "acme", { title: "Old" });
    await tasks.complete(ctx, "a", done.id, 1);
    const result = await tasks.search(ctx, { clientId: "acme" });
    expect(result.items.map((i) => i.id)).toEqual([high.id, low.id]);
    expect(result.items[0]).toMatchObject({
      priority: "high",
      quadrant: "Q2-schedule",
    });
    const all = await tasks.search(ctx, { clientId: "acme", states: ["done"] });
    expect(all.items.map((i) => i.id)).toEqual([done.id]);
  });

  test("a summary carries the done day, kind and tracker link", async () => {
    const ctx = await fixture();
    const item = await tasks.add(ctx, "a", "acme", {
      title: "Ship",
      kind: "admin",
      tracker: {
        system: "github",
        key: "acme/app#7",
        url: "https://github.com/acme/app/issues/7",
      },
    });
    await tasks.complete(ctx, "a", item.id, 1);
    const [found] = (await tasks.search(ctx, { states: ["done"] })).items;
    expect(found).toMatchObject({
      doneOn: "2026-10-24",
      kind: "admin",
      trackerKey: "acme/app#7",
      trackerUrl: "https://github.com/acme/app/issues/7",
    });
  });

  test("unclaimed leaves out claimed items", async () => {
    const ctx = await fixture();
    const a = await tasks.add(ctx, "a", "acme", { title: "One" });
    const b = await tasks.add(ctx, "a", "acme", { title: "Two" });
    await tasks.claim(ctx, "builder", a.id);
    const result = await tasks.search(ctx, { unclaimed: true });
    expect(result.items.map((i) => i.id)).toEqual([b.id]);
    expect(
      (await tasks.search(ctx, { claimedBy: "builder" })).items[0]?.claimedBy,
    ).toBe("builder");
  });
});

describe("update", () => {
  test("records a state change, a move and an edit, and logs the note", async () => {
    const ctx = await fixture();
    const item = await tasks.add(ctx, "a", "acme", { title: "Ship" });
    const revision = await tasks.update(
      ctx,
      "builder",
      item.id,
      1,
      { state: "doing", scheduledFor: "2026-10-26", summary: "Started" },
      { note: "picked up" },
    );
    expect(revision).toBe(2);
    const read = await tasks.read(ctx, item.id);
    expect(read.history?.slice(1)).toEqual([
      {
        kind: "state",
        on: "2026-10-24",
        at: "2026-10-24T09:00:00Z",
        by: "builder",
        from: "todo",
        to: "doing",
      },
      {
        kind: "moved",
        on: "2026-10-24",
        at: "2026-10-24T09:00:00Z",
        by: "builder",
        from: "unscheduled",
        to: "2026-10-26",
      },
      {
        kind: "edited",
        on: "2026-10-24",
        at: "2026-10-24T09:00:00Z",
        by: "builder",
      },
    ]);
    expect(read.log).toEqual([
      {
        at: "2026-10-24T09:00:00Z",
        status: "doing",
        note: "picked up",
        by: "builder",
      },
    ]);
  });

  test("null clears a field", async () => {
    const ctx = await fixture();
    const item = await tasks.add(ctx, "a", "acme", {
      title: "Ship",
      due: "2026-10-30",
    });
    await tasks.update(ctx, "a", item.id, 1, { due: null });
    expect((await tasks.read(ctx, item.id)).due).toBeUndefined();
  });

  test("a stale revision is refused", async () => {
    const ctx = await fixture();
    const item = await tasks.add(ctx, "a", "acme", { title: "Ship" });
    await tasks.update(ctx, "a", item.id, 1, { title: "First" });
    await expect(
      tasks.update(ctx, "b", item.id, 1, { title: "Second" }),
    ).rejects.toBeInstanceOf(RevisionConflict);
  });

  test("another agent's claim is respected unless forced", async () => {
    const ctx = await fixture();
    const item = await tasks.add(ctx, "a", "acme", { title: "Ship" });
    const revision = await tasks.claim(ctx, "builder", item.id);
    await expect(
      tasks.update(ctx, "commander", item.id, revision, { title: "Mine" }),
    ).rejects.toBeInstanceOf(ClaimConflict);
    await tasks.update(
      ctx,
      "commander",
      item.id,
      revision,
      { title: "Mine" },
      { force: true },
    );
    expect((await tasks.read(ctx, item.id)).claim?.by).toBe("builder");
  });

  test("an update that changes nothing is refused without spending a revision", async () => {
    const ctx = await fixture();
    const item = await tasks.add(ctx, "a", "acme", { title: "Ship" });
    await expect(
      tasks.update(ctx, "a", item.id, 1, { title: "Ship" }),
    ).rejects.toBeInstanceOf(tasks.NothingToChange);
    expect((await tasks.read(ctx, item.id)).revision).toBe(1);
  });

  test("an invalid value is refused with the schema's reason", async () => {
    const ctx = await fixture();
    const item = await tasks.add(ctx, "a", "acme", { title: "Ship" });
    await expect(
      tasks.update(ctx, "a", item.id, 1, { title: "x".repeat(301) }),
    ).rejects.toBeInstanceOf(InvalidItem);
  });
});

describe("complete", () => {
  test("sets done today, clears the claim and blocked details, logs the note", async () => {
    const ctx = await fixture();
    const item = await tasks.add(ctx, "a", "acme", {
      title: "Ship",
      blocked: true,
      blockedOn: { since: "2026-10-20", waitingFor: "review" },
    });
    const revision = await tasks.claim(ctx, "builder", item.id);
    await tasks.complete(ctx, "builder", item.id, revision, { note: "merged" });
    const read = await tasks.read(ctx, item.id);
    expect(read).toMatchObject({
      state: "done",
      doneOn: "2026-10-24",
      blocked: false,
    });
    expect(read.claim).toBeUndefined();
    expect(read.blockedOn).toBeUndefined();
    expect(read.log?.at(-1)).toMatchObject({ status: "done", note: "merged" });
  });

  test("today follows the time zone, not UTC", async () => {
    const ctx = await fixture("2026-10-24T23:30:00Z");
    ctx.timeZone = "Europe/Stockholm";
    const item = await tasks.add(ctx, "a", "acme", { title: "Ship" });
    await tasks.complete(ctx, "a", item.id, 1);
    expect((await tasks.read(ctx, item.id)).doneOn).toBe("2026-10-25");
  });
});

describe("log", () => {
  test("appends without changing the revision", async () => {
    const ctx = await fixture();
    const item = await tasks.add(ctx, "a", "acme", { title: "Ship" });
    await tasks.log(
      ctx,
      "builder",
      item.id,
      "blocked",
      "waiting for the token",
    );
    const read = await tasks.read(ctx, item.id);
    expect(read.revision).toBe(1);
    expect(read.log).toHaveLength(1);
  });
});

describe("clients", () => {
  test("lists clients with their own workstreams", async () => {
    const ctx = await fixture();
    expect(await tasks.clients(ctx)).toEqual([
      {
        id: "acme",
        name: "Acme",
        classification: "client-confidential",
        workstreams: [{ id: "acme-delivery", title: "Delivery" }],
      },
      {
        id: "globex",
        name: "Globex",
        classification: "internal",
        workstreams: [{ id: "globex-ops", title: "Operations" }],
      },
    ]);
  });
});
