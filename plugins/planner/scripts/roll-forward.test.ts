import { expect, test } from "bun:test";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const SCRIPT = join(import.meta.dir, "roll-forward.ts");
const ARCHIVE = join(import.meta.dir, "archive-done.ts");

interface Run {
  out: string;
  err: string;
  code: number;
  text: string;
  path: string;
}

/** Run a script against a fixture and read back the file it produced. */
function run(script: string, dashboard: string, flags: string[] = []): Run {
  const dir = mkdtempSync(join(tmpdir(), "roll-"));
  const path = join(dir, "Dashboard.md");
  writeFileSync(path, dashboard, "utf8");
  return exec(script, path, flags);
}

function exec(script: string, path: string, flags: string[] = []): Run {
  const proc = Bun.spawnSync(["bun", script, ...flags], {
    env: {
      ...process.env,
      DASHBOARD_PATH: path,
      DASHBOARD_SNAPSHOT_DIR: join(path, "..", "snapshots"),
    },
  });
  return {
    out: proc.stdout.toString(),
    err: proc.stderr.toString(),
    code: proc.exitCode ?? 0,
    text: readFileSync(path, "utf8"),
    path,
  };
}

const FIXTURE = `# Dashboard

## Focus

> [!note]- How to maintain this Focus log (for editors)
>
> Prose that must never move.

### Wednesday 16 September

#### **Acme**

> [!note] Intention: three things and nothing else.

- [x] Done thing
- [ ] 🔄 Claimed open thing
- [ ] 🧾 Admin thing

#### **Globex**

- [ ] Globex open thing

> [!note]- Tomorrow
>
> ### Thursday 17 September
>
> #### **Acme**
>
> - [ ] Already planned for tomorrow

> [!note]- Future
>
> ### Friday 18 September
>
> #### **Umbrella**
>
> - [ ] Friday thing
>
> ### Unscheduled — no day assigned
>
> #### **Initech**
>
> - [ ] Someday thing

## Initiatives

Untouched.
`;

/* --------------------------------------------------------------- rolling */

test("moves today's open items into the Tomorrow callout", () => {
  const r = run(SCRIPT, FIXTURE);
  expect(r.code).toBe(0);
  expect(r.text).toContain("> - [ ] 🧾 Admin thing");
  expect(r.text).toContain("> - [ ] Globex open thing");
});

test("leaves ticked items for the archive", () => {
  const r = run(SCRIPT, FIXTURE);
  expect(r.text).toContain("- [x] Done thing");
  expect(r.text).not.toContain("> - [x] Done thing");
});

test("drops the claim marker but keeps the others", () => {
  const r = run(SCRIPT, FIXTURE);
  expect(r.text).not.toContain("🔄");
  expect(r.text).toContain("🧾");
});

test("appends after tomorrow's existing items, preserving order", () => {
  const r = run(SCRIPT, FIXTURE);
  const lines = r.text.split("\n");
  const planned = lines.findIndex((l) => l.includes("Already planned for tomorrow"));
  const rolled = lines.findIndex((l) => l.includes("Claimed open thing"));
  expect(planned).toBeGreaterThan(-1);
  expect(rolled).toBeGreaterThan(planned);
});

test("creates a client group that tomorrow does not have", () => {
  const r = run(SCRIPT, FIXTURE);
  expect(r.text).toContain("> #### **Globex**");
});

test("removes a group the roll emptied", () => {
  const r = run(SCRIPT, FIXTURE);
  const focus = r.text.slice(r.text.indexOf("## Focus"), r.text.indexOf("## Initiatives"));
  const today = focus.slice(focus.indexOf("### Wednesday"), focus.indexOf("> [!note]- Tomorrow"));
  expect(today).not.toContain("#### **Globex**");
});

test("never touches the operator's prose", () => {
  const r = run(SCRIPT, FIXTURE);
  expect(r.text).toContain("Prose that must never move.");
  expect(r.text).toContain("Intention: three things and nothing else.");
  expect(r.text).toContain("Untouched.");
});

test("leaves everything outside Focus alone", () => {
  const r = run(SCRIPT, FIXTURE);
  expect(r.text.slice(r.text.indexOf("## Initiatives"))).toBe(
    FIXTURE.slice(FIXTURE.indexOf("## Initiatives")),
  );
});

test("--dry-run changes nothing", () => {
  const r = run(SCRIPT, FIXTURE, ["--dry-run"]);
  expect(r.out).toContain("DRY RUN");
  expect(r.text).toBe(FIXTURE);
});

/* ---------------------------------------------------------------- shifting */

test("refuses to shift while today still has content", () => {
  const r = run(SCRIPT, FIXTURE, ["--verbose"]);
  expect(r.out).toContain("no shift");
  expect(r.text).toContain("### Wednesday 16 September");
});

test("shifts once the day is archived, and never promotes Unscheduled", () => {
  const first = run(SCRIPT, FIXTURE);
  exec(ARCHIVE, first.path);
  const r = exec(SCRIPT, first.path, ["--verbose"]);
  expect(r.out).toContain("promoted to today: Thursday 17 September");
  expect(r.out).toContain("new tomorrow: Friday 18 September");
  expect(r.text).toContain("### Thursday 17 September");
  // Unscheduled stays one level deep in Future; only a dated day is promoted.
  expect(r.text).not.toContain("\n### Unscheduled");
  expect(r.text).toContain("> ### Unscheduled — no day assigned");
});

test("the promoted day loses exactly one quote level", () => {
  const first = run(SCRIPT, FIXTURE);
  exec(ARCHIVE, first.path);
  const r = exec(SCRIPT, first.path);
  expect(r.text).toContain("\n#### **Acme**\n");
  expect(r.text).toContain("\n- [ ] Already planned for tomorrow\n");
});

test("leaves exactly one unprefixed day heading", () => {
  const first = run(SCRIPT, FIXTURE);
  exec(ARCHIVE, first.path);
  const r = exec(SCRIPT, first.path);
  const focus = r.text.slice(r.text.indexOf("## Focus"), r.text.indexOf("## Initiatives"));
  const unprefixed = focus.split("\n").filter((l) => /^### /.test(l));
  expect(unprefixed).toHaveLength(1);
});

test("does not double the blank lines inside a callout", () => {
  const first = run(SCRIPT, FIXTURE);
  exec(ARCHIVE, first.path);
  const r = exec(SCRIPT, first.path);
  expect(r.text).not.toContain("\n>\n>\n");
});

test("an empty Future leaves an empty Tomorrow callout, which is correct", () => {
  const noFuture = FIXTURE.replace(
    /> \[!note\]- Future[\s\S]*?\n\n## Initiatives/,
    "> [!note]- Future\n\n## Initiatives",
  );
  const first = run(SCRIPT, noFuture);
  exec(ARCHIVE, first.path);
  const r = exec(SCRIPT, first.path);
  expect(r.text).toContain("> [!note]- Tomorrow");
  expect(r.text).toContain("### Thursday 17 September");
});

/* --------------------------------------------------------------- shift only */

test("--shift-only turns the page without rolling anyone's open items", () => {
  // The state an archive leaves behind: no today, work still open tomorrow.
  const archived = FIXTURE.replace(
    /### Wednesday 16 September[\s\S]*?(?=> \[!note\]- Tomorrow)/,
    "",
  );
  const r = run(SCRIPT, archived, ["--verbose"]);
  expect(r.out).toContain("promoted to today: Thursday 17 September");
  expect(r.out).not.toContain("rolled —");
  expect(r.text).toContain("- [ ] Already planned for tomorrow");
});

test("--shift-only leaves today's open items alone", () => {
  const r = run(SCRIPT, FIXTURE, ["--shift-only", "--verbose"]);
  // Today still has content, so there is nothing to promote and nothing rolls.
  expect(r.out.trim()).toBe("Nothing to shift");
  expect(r.text).toBe(FIXTURE);
});

test("archive then --shift-only turns the page in two runs", () => {
  const first = run(SCRIPT, FIXTURE);
  exec(ARCHIVE, first.path);
  const r = exec(SCRIPT, first.path, ["--shift-only", "--verbose"]);
  expect(r.out).toContain("promoted to today: Thursday 17 September");
  expect(r.out).toContain("new tomorrow: Friday 18 September");
  const focus = r.text.slice(r.text.indexOf("## Focus"), r.text.indexOf("## Initiatives"));
  expect(focus.split("\n").filter((x) => /^### /.test(x))).toHaveLength(1);
});

/* ------------------------------------------------------------ safety rails */

test("says so and writes nothing when there is nothing to do", () => {
  const empty = `# Dashboard\n\n## Focus\n\n> [!note]- Tomorrow\n\n> [!note]- Future\n\n## Initiatives\n`;
  const r = run(SCRIPT, empty);
  expect(r.out.trim()).toBe("Nothing to roll");
  expect(r.text).toBe(empty);
});

test("is idempotent: a second run with nothing open does nothing", () => {
  const first = run(SCRIPT, FIXTURE);
  const second = exec(SCRIPT, first.path);
  expect(second.out.trim()).toBe("Nothing to roll");
  expect(second.text).toBe(first.text);
});

test("creates a missing Tomorrow band rather than writing into Future", () => {
  const noTomorrow = FIXTURE.replace(
    /> \[!note\]- Tomorrow\n>\n> ### Thursday 17 September\n>\n> #### \*\*Acme\*\*\n>\n> - \[ \] Already planned for tomorrow\n\n/,
    "",
  );
  const r = run(SCRIPT, noTomorrow);
  expect(r.text).toContain("> [!note]- Tomorrow");
  const focus = r.text.slice(r.text.indexOf("## Focus"));
  const tomorrowAt = focus.indexOf("> [!note]- Tomorrow");
  const futureAt = focus.indexOf("> [!note]- Future");
  expect(tomorrowAt).toBeLessThan(futureAt);
  expect(focus.slice(tomorrowAt, futureAt)).toContain("🧾 Admin thing");
});

test("refuses to write when an iCloud conflict copy is present", () => {
  const dir = mkdtempSync(join(tmpdir(), "roll-"));
  const path = join(dir, "Dashboard.md");
  writeFileSync(path, FIXTURE, "utf8");
  writeFileSync(join(dir, "Dashboard 2.md"), "conflicted", "utf8");
  const r = exec(SCRIPT, path);
  expect(r.code).toBe(1);
  expect(r.err).toContain("conflict");
  expect(r.text).toBe(FIXTURE);
});

test("fails loudly when there is no Focus section", () => {
  const r = run(SCRIPT, "# Dashboard\n\n## Initiatives\n\nNothing here.\n");
  expect(r.code).toBe(1);
  expect(r.err).toContain("Focus");
});
