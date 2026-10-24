import { expect, test } from "bun:test";
import { mkdtempSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const GUARD = join(import.meta.dir, "dashboard-guard.sh");

interface Run {
  code: number;
  out: string;
  err: string;
  snapshots: string[];
}

/** Run the guard against a fixture vault with its own config and snapshot dir. */
function run(dashboard: string, flags: string[] = []): Run {
  const dir = mkdtempSync(join(tmpdir(), "guard-"));
  const vault = join(dir, "vault");
  const snaps = join(dir, "snapshots");
  Bun.spawnSync(["mkdir", "-p", vault]);
  writeFileSync(join(vault, "Dashboard.md"), dashboard, "utf8");
  const config = join(dir, "obsidian.json");
  writeFileSync(config, JSON.stringify({ dashboard: "Dashboard.md", vault }));
  const proc = Bun.spawnSync(["bash", GUARD, ...flags], {
    env: {
      ...process.env,
      DASHBOARD_SNAPSHOT_DIR: snaps,
      OBSIDIAN_CONFIG: config,
    },
  });
  let snapshots: string[] = [];
  try {
    snapshots = readdirSync(snaps);
  } catch {
    // No snapshot directory means no snapshot was taken.
  }
  return {
    code: proc.exitCode ?? 0,
    err: proc.stderr.toString(),
    out: proc.stdout.toString(),
    snapshots,
  };
}

const SOUND = `# Dashboard

## Focus

> [!note]- How to maintain this Focus log (for editors)
> Prose.

### Tuesday 13 October

#### **Acme**

- [ ] Today

> [!note]- Tomorrow
>
> ### Wednesday 14 October

> [!note]- Future
>
> ### Thursday 15 October

## Initiatives

### Not a Focus day
`;

// 13 Oct: days written unprefixed below the Future callout.
const STRAY = SOUND.replace(
  "\n## Initiatives",
  "\n### Tuesday 13 October\n\n#### **Acme**\n\n- [ ] Stray\n\n## Initiatives",
);

test("snapshots a sound dashboard and prints the path", () => {
  const r = run(SOUND);
  expect(r.code).toBe(0);
  expect(r.snapshots).toHaveLength(1);
  expect(r.out.trim()).toEndWith(r.snapshots[0]);
});

test("refuses a second unprefixed day and takes no snapshot", () => {
  const r = run(STRAY);
  expect(r.code).toBe(1);
  expect(r.snapshots).toHaveLength(0);
  expect(r.err).toContain("2 unprefixed day headings in ## Focus");
  expect(r.err).toContain("line 22: ### Tuesday 13 October");
  expect(r.err).toContain(
    '3 lines below the Tomorrow and Future callouts have no "> " prefix',
  );
});

test("refuses a single item spilled below the bands", () => {
  const r = run(
    SOUND.replace(
      "\n## Initiatives",
      "\n- [ ] Lost its prefix\n\n## Initiatives",
    ),
  );
  expect(r.code).toBe(1);
  expect(r.err).toContain("line 22: - [ ] Lost its prefix");
});

test("--check reports the shape and takes no snapshot", () => {
  expect(run(SOUND, ["--check"])).toMatchObject({ code: 0, snapshots: [] });
  expect(run(STRAY, ["--check"])).toMatchObject({ code: 1, snapshots: [] });
});

test("--repair snapshots a misshapen dashboard with a warning", () => {
  const r = run(STRAY, ["--repair"]);
  expect(r.code).toBe(0);
  expect(r.snapshots).toHaveLength(1);
  expect(r.err).toContain("Repairing a misshapen dashboard");
});

test("an unknown flag is refused", () => {
  expect(run(SOUND, ["--force"]).code).toBe(2);
});

// 24 Oct: clients moved to the task database keep only a pointer line.
const MOVED = SOUND.replace(
  "#### **Acme**\n\n- [ ] Today",
  "#### **Globex**\n\n- [ ] Today",
).replace(
  "> ### Thursday 15 October\n",
  "> ### Thursday 15 October\n>\n> #### **Acme**\n>\n> Moved to the tasks database on 24 Oct 2026 (3 items).\n",
);
const withAcmeToday = (line: string) =>
  MOVED.replace("- [ ] Today\n", `- [ ] Today\n\n#### **Acme**\n\n${line}\n`);

test("a moved client's pointer line alone is sound", () => {
  const r = run(MOVED);
  expect(r.code).toBe(0);
  expect(r.snapshots).toHaveLength(1);
});

test("refuses an item under a moved client on another day, and takes no snapshot", () => {
  const refused = run(withAcmeToday("- [ ] Added the old way"));
  expect(refused.code).toBe(1);
  expect(refused.err).toContain("live in the task database (Acme)");
  expect(refused.err).toContain("/tasks:work");
  expect(refused.snapshots).toHaveLength(0);
  expect(run(withAcmeToday("- [ ] Added the old way"), ["--check"]).code).toBe(
    1,
  );
});

test("a calendar line under a moved client is allowed", () => {
  expect(run(withAcmeToday("- [ ] 📅 09:15–09:45 Stand-up")).code).toBe(0);
});

test("items under clients that have not moved are untouched by the rule", () => {
  expect(
    run(MOVED.replace("- [ ] Today", "- [ ] Today\n- [ ] Another")).code,
  ).toBe(0);
});
