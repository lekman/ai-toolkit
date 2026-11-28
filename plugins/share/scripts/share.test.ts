import { afterEach, beforeEach, expect, test } from "bun:test";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { addPage, discover } from "./home";
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
  const page = await get("/files", new Date("2026-10-07T10:00:00Z")).text();
  expect(page).toContain(
    "Session <strong>Emulator</strong> <code>sess-111</code>",
  );
  expect(page).toContain("Emulator screens");
  expect(page).toMatch(/Shared \w{3} 7 Oct/);
  expect(page).toContain('<img src="/home/s/');
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

test("the home page lists services, pages and file shares as cards, under / and /home/", async () => {
  mkdirSync(root, { recursive: true });
  writeFileSync(
    join(root, "services-status.json"),
    JSON.stringify([
      {
        backend: 6013,
        checkedAt: "2026-10-07T09:58:00Z",
        code: 200,
        description: "Components",
        folder: "atlas",
        hidden: false,
        key: "6443",
        kind: "Storybook",
        name: "Atlas Storybook",
        up: true,
        url: "https://host.ts.net:6443/",
      },
      {
        backend: 6006,
        checkedAt: "2026-10-07T09:58:00Z",
        code: null,
        description: null,
        folder: null,
        hidden: false,
        key: "6006",
        kind: "Web",
        name: "Port 6006",
        up: false,
        url: "http://host.ts.net:6006/",
      },
      {
        backend: 7400,
        checkedAt: "2026-10-07T09:58:00Z",
        code: 200,
        description: null,
        folder: null,
        hidden: true,
        key: "443",
        kind: "Web",
        name: "Old app",
        up: true,
        url: "https://host.ts.net/",
      },
    ]),
  );
  const s = addShare(
    [join(src, "notes.txt")],
    { session: "x", title: "Notes", ttl: "7d" },
    root,
  );
  const md = join(src, "plan.md");
  writeFileSync(md, "---\nstatus: draft\n---\n# The plan\n\nSome **text**.\n");
  const pg = addPage(md, root, { cwd: "/x", id: null, name: "Atlas" });
  for (const path of ["/", "/home/"]) {
    const home = await get(path).text();
    expect(home).toContain('href="https://host.ts.net:6443/"');
    expect(home).toContain("Atlas Storybook");
    expect(home).toContain(`href="/plans/${pg.slug}.html"`);
    expect(home).toContain(`href="/home/s/${s.id}/"`);
    expect(home).toContain("1 route not answering");
    expect(home).toContain("1 hidden");
    expect(home).not.toContain('href="https://host.ts.net/"');
  }
  expect(get("/home").status).toBe(301);
});

test("a shared page is served under /plans/ and, with the mount stripped, at the root", async () => {
  const md = join(src, "plan.md");
  writeFileSync(md, "# Title\n\n| A | B |\n| --- | --- |\n| 1 | 2 |\n");
  const pg = addPage(md, root, { cwd: "/x", id: null, name: null });
  expect(pg.slug).toBe("plan");
  for (const path of ["/plans/plan.html", "/plan.html"]) {
    const html = await get(path).text();
    expect(html).toContain("<title>Title</title>");
    expect(html).toContain("<td>1</td>");
  }
  expect(get("/plans/missing.html").status).toBe(404);
});

test("routes come from tailscale serve status, named from services.json or what answers", async () => {
  mkdirSync(root, { recursive: true });
  writeFileSync(
    join(root, "services.json"),
    JSON.stringify({
      "6443": { name: "Atlas Storybook" },
      "443": { hide: true },
    }),
  );
  const status = {
    TCP: {
      "443": { HTTPS: true },
      "6443": { HTTPS: true },
      "6006": { HTTP: true },
    },
    Web: {
      "host.ts.net:443": {
        Handlers: {
          "/": { Proxy: "http://127.0.0.1:7400" },
          "/home": { Proxy: "http://127.0.0.1:8765" },
        },
      },
      "host.ts.net:6443": {
        Handlers: { "/": { Proxy: "http://127.0.0.1:6013" } },
      },
      "host.ts.net:6006": {
        Handlers: { "/": { Proxy: "http://127.0.0.1:6006" } },
      },
    },
  };
  const found = await discover(
    root,
    status,
    async (p) =>
      p === 6006
        ? { code: 200, title: "storybook - Storybook" }
        : p === 6013
          ? { code: 200, title: "x" }
          : { code: 200, title: "Atlas" },
    (p) => (p === 6006 ? "~/Repo/app/.worktrees/feature/packages/ui" : null),
    8765,
  );
  expect(found.map((f) => f.key)).toEqual(["443", "6006", "6443"]);
  expect(found.find((f) => f.key === "443")?.hidden).toBe(true);
  expect(found.find((f) => f.key === "6443")?.name).toBe("Atlas Storybook");
  expect(found.find((f) => f.key === "6006")).toMatchObject({
    kind: "Storybook",
    name: "app · feature/packages/ui",
    url: "http://host.ts.net:6006/",
  });
  expect(found.some((f) => f.backend === 8765)).toBe(false);
});

test("the CLI shares and removes a page, and names a service, without touching the tailnet", () => {
  const env = { ...process.env, SHARE_HOME: root, SHARE_NO_TAILNET: "1" };
  const run = (...args: string[]) =>
    Bun.spawnSync(["bun", SCRIPT, ...args], { env });
  const md = join(src, "plan.md");
  writeFileSync(md, "# The plan\n");
  mkdirSync(root, { recursive: true });
  writeFileSync(
    join(root, "config.json"),
    JSON.stringify({ publicBase: "https://server.example.com/" }),
  );
  const shared = run("page", md, "--slug", "Questions plan");
  expect(shared.exitCode).toBe(0);
  expect(shared.stdout.toString()).toContain(
    "The plan: https://server.example.com/plans/questions-plan.html",
  );
  expect(existsSync(join(root, "pages", "questions-plan.html"))).toBe(true);
  expect(run("unpage", "questions-plan").exitCode).toBe(0);
  expect(existsSync(join(root, "pages", "questions-plan.html"))).toBe(false);
  expect(
    run("name", "6006", "Design", "system", "--description", "Components")
      .exitCode,
  ).toBe(0);
  expect(
    JSON.parse(readFileSync(join(root, "services.json"), "utf8"))["6006"],
  ).toEqual({ name: "Design system", description: "Components" });
  expect(run("name", "abc", "x").exitCode).toBe(2);
});
