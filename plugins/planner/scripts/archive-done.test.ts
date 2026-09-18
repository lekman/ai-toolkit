import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const SCRIPT = join(import.meta.dir, "archive-done.ts");

interface Run {
  out: string;
  err: string;
  code: number;
  dashboard: string;
  dir: string;
  log: string;
}

const YEAR = String(new Date().getFullYear());

/** Run the archiver against a fixture and read back what it produced. */
function run(
  dashboard: string,
  flags: string[] = [],
  prepare?: (dir: string) => void,
): Run {
  const dir = mkdtempSync(join(tmpdir(), "archive-"));
  const path = join(dir, "Dashboard.md");
  writeFileSync(path, dashboard, "utf8");
  prepare?.(dir);
  const proc = Bun.spawnSync(["bun", SCRIPT, ...flags], {
    env: {
      ...process.env,
      DASHBOARD_PATH: path,
      DASHBOARD_SNAPSHOT_DIR: join(dir, "snapshots"),
    },
  });
  const logPath = join(dir, "Archive", "Work Logs", YEAR, "September.md");
  let log: string;
  try {
    log = readFileSync(logPath, "utf8");
  } catch {
    // A run that archived nothing, or failed first, leaves no log at all.
    log = "";
  }
  return {
    out: proc.stdout.toString(),
    err: proc.stderr.toString(),
    code: proc.exitCode ?? 0,
    dashboard: readFileSync(path, "utf8"),
    dir,
    log,
  };
}

const FIXTURE = `# Dashboard

## Focus

### Wednesday 16 September

#### **Acme**

> [!note] Intention: prose that must never move.

- [x] Finished thing
- [ ] Unfinished thing

> [!note]- Tomorrow
>
> ### Thursday 17 September

> [!note]- Future

## Initiatives

Untouched.
`;

test("creates the work log when there is not one yet", () => {
  const r = run(FIXTURE);
  expect(r.code).toBe(0);
  expect(r.log).toContain("# Work Log: September");
  expect(r.log).toContain("type: reference");
  expect(r.log).toContain("- [x] Finished thing");
});

test("moves only the ticked item, leaving the open one and the prose", () => {
  const r = run(FIXTURE);
  expect(r.dashboard).toContain("- [ ] Unfinished thing");
  expect(r.dashboard).not.toContain("- [x] Finished thing");
  expect(r.dashboard).toContain("Intention: prose that must never move.");
});

test("merges into an existing log rather than starting a second one", () => {
  const existing = `---\ntype: reference\n---\n\n# Work Log: September ${YEAR}\n\n#### Monday 1 September\n\n**Globex**\n\n- [x] An older entry\n`;
  const r = run(FIXTURE, [], (dir) => {
    mkdirSync(join(dir, "Archive", "Work Logs", YEAR), { recursive: true });
    writeFileSync(
      join(dir, "Archive", "Work Logs", YEAR, "September.md"),
      existing,
      "utf8",
    );
  });
  expect(r.code).toBe(0);
  expect(r.log.match(/# Work Log: September/g)).toHaveLength(1);
  expect(r.log).toContain("- [x] An older entry");
  expect(r.log).toContain("- [x] Finished thing");
});

test("says so and writes nothing when there is nothing ticked", () => {
  const nothing = FIXTURE.replace("- [x] Finished thing\n", "");
  const r = run(nothing);
  expect(r.out.trim()).toBe("No items found to archive");
  expect(r.dashboard).toBe(nothing);
  expect(r.log).toBe("");
});

test("--dry-run changes neither file", () => {
  const r = run(FIXTURE, ["--dry-run"]);
  expect(r.out).toContain("DRY RUN");
  expect(r.dashboard).toBe(FIXTURE);
  expect(r.log).toBe("");
});

test("an unreadable work log stops the run instead of being read as absent", () => {
  // Existence is no longer checked before the read, so a path that exists but
  // cannot be read has to surface as an error rather than silently taking the
  // "create a new log" branch and overwriting it.
  const r = run(FIXTURE, [], (dir) => {
    mkdirSync(join(dir, "Archive", "Work Logs", YEAR, "September.md"), {
      recursive: true,
    });
  });
  expect(r.code).toBe(1);
  expect(r.err).toContain("cannot read");
  // The dashboard is untouched, so nothing was archived into nowhere.
  expect(r.dashboard).toBe(FIXTURE);
});

test("turns the page even when bun is not on PATH", () => {
  // Obsidian inherits no login shell's PATH, so a mise shim is not found there
  // — the plugin carries a resolveBun() probe for exactly that reason. Spawning
  // the shift by bare name failed *after* the dashboard write, which archived
  // the day and left the file with no day in focus at all.
  const dir = mkdtempSync(join(tmpdir(), "archive-"));
  const path = join(dir, "Dashboard.md");
  // Everything ticked, so the day empties and the shift has something to do.
  writeFileSync(path, FIXTURE.replace("- [ ] Unfinished thing\n", ""), "utf8");
  const proc = Bun.spawnSync([process.execPath, SCRIPT, "--verbose"], {
    env: {
      HOME: process.env.HOME ?? "",
      PATH: "/usr/bin:/bin:/usr/sbin:/sbin",
      DASHBOARD_PATH: path,
      DASHBOARD_SNAPSHOT_DIR: join(dir, "snapshots"),
    },
  });
  expect(proc.exitCode).toBe(0);
  expect(proc.stdout.toString()).toContain("promoted to today");

  // Exactly one unprefixed day heading, and it is the promoted one.
  const after = readFileSync(path, "utf8");
  const focus = after.slice(
    after.indexOf("## Focus"),
    after.indexOf("## Initiatives"),
  );
  expect(focus.split("\n").filter((l) => /^### /.test(l))).toEqual([
    "### Thursday 17 September",
  ]);
});

test("says which dashboard is missing rather than failing on the read", () => {
  const dir = mkdtempSync(join(tmpdir(), "archive-"));
  const proc = Bun.spawnSync(["bun", SCRIPT], {
    env: { ...process.env, DASHBOARD_PATH: join(dir, "Gone.md") },
  });
  expect(proc.exitCode).toBe(1);
  expect(proc.stderr.toString()).toContain("no dashboard at");
});
