import { afterEach, beforeEach, expect, test } from "bun:test";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  addShare,
  handle,
  hostRefused,
  parseTtl,
  readShares,
  removeShares,
  sessionName,
  sweep,
} from "./share";

const SCRIPT = join(import.meta.dir, "share.ts");
let root: string;
let sessions: string;
let src: string;

beforeEach(() => {
  const base = mkdtempSync(join(tmpdir(), "share-test-"));
  root = join(base, "home");
  sessions = join(base, "sessions");
  src = join(base, "src");
  mkdirSync(sessions, { recursive: true });
  mkdirSync(join(src, "report"), { recursive: true });
  writeFileSync(join(src, "shot.png"), "png-bytes");
  writeFileSync(join(src, "report", "index.html"), "<h1>report</h1>");
  writeFileSync(join(src, "notes.txt"), "hello");
  // The file Claude Code keeps for a running session, trimmed to the fields read.
  writeFileSync(
    join(sessions, "4242.json"),
    JSON.stringify({ name: "Emulator", sessionId: "sess-1111-2222" }),
  );
});
afterEach(() => rmSync(join(root, ".."), { force: true, recursive: true }));

const get = (path: string, now?: Date) =>
  handle(new Request(`http://127.0.0.1:8765${path}`), root, now);

test("the session's name comes from its session file, and null when there is none", () => {
  expect(sessionName("sess-1111-2222", sessions)).toBe("Emulator");
  expect(sessionName("someone-else", sessions)).toBeNull();
  expect(sessionName(null, sessions)).toBeNull();
  expect(sessionName("sess-1111-2222", join(sessions, "missing"))).toBeNull();
});

test("add copies the files and records the session and the time", () => {
  process.env.CLAUDE_SESSIONS_DIR = sessions;
  const now = new Date("2026-10-07T09:00:00Z");
  const s = addShare(
    [join(src, "shot.png"), join(src, "report")],
    { now, session: "sess-1111-2222", title: "Emulator screens", ttl: "2h" },
    root,
  );
  expect(s.session).toMatchObject({ id: "sess-1111-2222", name: "Emulator" });
  expect(s.sharedAt).toBe("2026-10-07T09:00:00.000Z");
  expect(s.expiresAt).toBe("2026-10-07T11:00:00.000Z");
  expect(s.files.map((f) => [f.name, f.dir])).toEqual([
    ["shot.png", false],
    ["report", true],
  ]);
  // A copy: removing the original leaves the share whole.
  rmSync(join(src, "shot.png"));
  expect(existsSync(join(root, s.id, "files", "shot.png"))).toBe(true);
  expect(readShares(root).map((x) => x.id)).toEqual([s.id]);
});

test("two paths with the same file name both survive", () => {
  mkdirSync(join(src, "b"));
  writeFileSync(join(src, "b", "notes.txt"), "other");
  const s = addShare(
    [join(src, "notes.txt"), join(src, "b", "notes.txt")],
    { session: "x" },
    root,
  );
  expect(s.files.map((f) => f.name)).toEqual(["notes.txt", "2-notes.txt"]);
});

test("add refuses a path that does not exist, and a bad lifetime", () => {
  expect(() => addShare([join(src, "nope.png")], {}, root)).toThrow(
    "not found",
  );
  expect(() => parseTtl("tomorrow")).toThrow("--ttl");
  expect(parseTtl("30m")).toBe(1_800_000);
  expect(parseTtl("7d")).toBe(604_800_000);
});

test("remove by id, by session, and expired", () => {
  const now = new Date();
  const a = addShare([join(src, "notes.txt")], { now, session: "s-a" }, root);
  const b = addShare([join(src, "notes.txt")], { now, session: "s-b" }, root);
  const old = addShare(
    [join(src, "notes.txt")],
    { now: new Date(now.getTime() - 3 * 3_600_000), session: "s-b", ttl: "1h" },
    root,
  );
  expect(removeShares({ expired: true }, root)).toEqual([old.id]);
  expect(removeShares({ session: "s-b" }, root)).toEqual([b.id]);
  expect(removeShares({ ids: [a.id] }, root)).toEqual([a.id]);
  expect(readShares(root)).toEqual([]);
});

test("the index groups shares under the session that shared them, with the time", async () => {
  process.env.CLAUDE_SESSIONS_DIR = sessions;
  addShare(
    [join(src, "shot.png")],
    {
      now: new Date("2026-10-07T09:00:00Z"),
      session: "sess-1111-2222",
      title: "Emulator screens",
      ttl: "7d",
    },
    root,
  );
  const page = await get("/", new Date("2026-10-07T10:00:00Z")).text();
  expect(page).toContain(
    "Session <strong>Emulator</strong> <code>sess-111</code>",
  );
  expect(page).toContain("Emulator screens");
  expect(page).toMatch(/Shared \w{3} 7 Oct/);
  expect(page).toContain('<img src="/s/');
});

test("files are served, a folder serves its index.html, and nothing outside the share is", async () => {
  const s = addShare(
    [join(src, "notes.txt"), join(src, "report")],
    { session: "x" },
    root,
  );
  expect(await get(`/s/${s.id}/notes.txt`).text()).toBe("hello");
  expect(await get(`/s/${s.id}/report/`).text()).toBe("<h1>report</h1>");
  expect(get(`/s/${s.id}/report`).status).toBe(301);
  expect(get(`/s/${s.id}/..%2Fshare.json`).status).toBe(404);
  expect(get(`/s/${s.id}/%2E%2E/%2E%2E/etc/passwd`).status).toBe(404);
  expect(get(`/s/nope/notes.txt`).status).toBe(404);
  expect(get("/", undefined).status).toBe(200);
  expect(
    handle(new Request("http://x/", { method: "POST" }), root).status,
  ).toBe(405);
});

test("an expired share is no longer served, and the sweep deletes it", async () => {
  const s = addShare(
    [join(src, "notes.txt")],
    { now: new Date("2026-10-01T00:00:00Z"), session: "x", ttl: "1h" },
    root,
  );
  expect(
    get(`/s/${s.id}/notes.txt`, new Date("2026-10-01T02:00:00Z")).status,
  ).toBe(404);
  expect(sweep(root, new Date("2026-10-01T02:00:00Z"))).toEqual([s.id]);
  expect(existsSync(join(root, s.id))).toBe(false);
});

test("the CLI adds, lists and removes without touching the tailnet", () => {
  const env = {
    ...process.env,
    CLAUDE_CODE_SESSION_ID: "sess-1111-2222",
    CLAUDE_SESSIONS_DIR: sessions,
    SHARE_HOME: root,
    SHARE_NO_TAILNET: "1",
  };
  const run = (...args: string[]) =>
    Bun.spawnSync(["bun", SCRIPT, ...args], { env });
  const added = run("add", join(src, "notes.txt"), "--title", "Notes");
  expect(added.exitCode).toBe(0);
  expect(added.stdout.toString()).toContain(
    "Session: Emulator (sess-1111-2222)",
  );
  expect(run("list").stdout.toString()).toContain("Emulator sess-111\tNotes");
  expect(run("remove", "--session").stdout.toString()).toContain("Removed");
  expect(run("list").stdout.toString()).toContain("Nothing is shared.");
  expect(run("add", join(src, "missing")).exitCode).toBe(2);
});

test("a dev server's host refusal is told apart from other answers", () => {
  // Storybook 10.6 answered exactly this to the tailnet name when bound to 127.0.0.1.
  expect(hostRefused({ status: 403, text: "Invalid host" })).toBe(true);
  expect(
    hostRefused({
      status: 403,
      text: "Blocked request. This host is not allowed.",
    }),
  ).toBe(true);
  expect(hostRefused({ status: 403, text: "Forbidden" })).toBe(false);
  expect(hostRefused({ status: 200, text: "<html>" })).toBe(false);
  expect(hostRefused(null)).toBe(false);
});
