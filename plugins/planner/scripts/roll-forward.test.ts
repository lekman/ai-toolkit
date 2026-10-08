import { expect, test } from "bun:test";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const SCRIPT = join(import.meta.dir, "roll-forward.ts");

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
      DASHBOARD_TODAY: `${new Date().getFullYear()}-09-16`,
      DASHBOARD_SNAPSHOT_DIR: join(path, "..", "snapshots"),
    },
  });
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch {
    // A run that failed before writing may have left no file at all.
    text = "";
  }
  return {
    out: proc.stdout.toString(),
    err: proc.stderr.toString(),
    code: proc.exitCode ?? 0,
    text,
    path,
  };
}

/** The work log the archive writes beside a fixture dashboard. */
function workLog(path: string): string {
  const log = join(
    path,
    "..",
    "Archive",
    "Work Logs",
    String(new Date().getFullYear()),
    "September.md",
  );
  try {
    return readFileSync(log, "utf8");
  } catch {
    return "";
  }
}

/** The unprefixed day, from its heading to the Tomorrow band. */
function todayOf(text: string): string {
  const start = text.search(/^### /m);
  return start < 0
    ? ""
    : text.slice(start, text.indexOf("> [!note]- Tomorrow"));
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

test("moves today's open items into tomorrow, which becomes today", () => {
  const r = run(SCRIPT, FIXTURE);
  expect(r.code).toBe(0);
  const today = todayOf(r.text);
  expect(today).toContain("### Thursday 17 September");
  expect(today).toContain("\n- [ ] 🧾 Admin thing");
  expect(today).toContain("\n- [ ] Globex open thing");
});

test("files ticked items in the work log", () => {
  const r = run(SCRIPT, FIXTURE);
  expect(r.text).not.toContain("Done thing");
  expect(workLog(r.path)).toContain("- [x] Done thing");
});

test("drops the claim marker but keeps the others", () => {
  const r = run(SCRIPT, FIXTURE);
  expect(r.text).not.toContain("🔄");
  expect(r.text).toContain("🧾");
});

test("appends after tomorrow's existing items, preserving order", () => {
  const r = run(SCRIPT, FIXTURE);
  const lines = r.text.split("\n");
  const planned = lines.findIndex((l) =>
    l.includes("Already planned for tomorrow"),
  );
  const rolled = lines.findIndex((l) => l.includes("Claimed open thing"));
  expect(planned).toBeGreaterThan(-1);
  expect(rolled).toBeGreaterThan(planned);
});

test("creates a client group that tomorrow does not have", () => {
  const r = run(SCRIPT, FIXTURE);
  expect(todayOf(r.text)).toContain("\n#### **Globex**\n");
});

test("removes a group the roll emptied", () => {
  const r = run(SCRIPT, FIXTURE);
  const focus = r.text.slice(
    r.text.indexOf("## Focus"),
    r.text.indexOf("## Initiatives"),
  );
  const today = focus.slice(
    focus.indexOf("### Wednesday"),
    focus.indexOf("> [!note]- Tomorrow"),
  );
  expect(today).not.toContain("#### **Globex**");
});

test("keeps the operator's prose, and files the day's intention with the day", () => {
  const r = run(SCRIPT, FIXTURE);
  expect(r.text).toContain("Prose that must never move.");
  expect(r.text).toContain("Untouched.");
  expect(r.text).not.toContain("Intention: three things and nothing else.");
  expect(workLog(r.path)).toContain(
    "Intention: three things and nothing else.",
  );
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

test("one roll archives what the day finished and turns the page", () => {
  const r = run(SCRIPT, FIXTURE, ["--verbose"]);
  expect(r.out).toContain("promoted to today: Thursday 17 September");
  expect(r.out).toContain("new tomorrow: Friday 18 September");
  expect(r.text).not.toContain("### Wednesday 16 September");
});

test("the roll never promotes Unscheduled", () => {
  const r = run(SCRIPT, FIXTURE);
  expect(r.text).toContain("### Thursday 17 September");
  // Unscheduled stays one level deep in Future; only a dated day is promoted.
  expect(r.text).not.toContain("\n### Unscheduled");
  expect(r.text).toContain("> ### Unscheduled — no day assigned");
});

test("the promoted day loses exactly one quote level", () => {
  const r = run(SCRIPT, FIXTURE);
  expect(r.text).toContain("\n#### **Acme**\n");
  expect(r.text).toContain("\n- [ ] Already planned for tomorrow\n");
});

test("leaves exactly one unprefixed day heading", () => {
  const r = run(SCRIPT, FIXTURE);
  const focus = r.text.slice(
    r.text.indexOf("## Focus"),
    r.text.indexOf("## Initiatives"),
  );
  const unprefixed = focus.split("\n").filter((l) => /^### /.test(l));
  expect(unprefixed).toHaveLength(1);
});

test("does not double the blank lines inside a callout", () => {
  const r = run(SCRIPT, FIXTURE);
  expect(r.text).not.toContain("\n>\n>\n");
});

test("an empty Future leaves an empty Tomorrow callout, which is correct", () => {
  const noFuture = FIXTURE.replace(
    /> \[!note\]- Future[\s\S]*?\n\n## Initiatives/,
    "> [!note]- Future\n\n## Initiatives",
  );
  const r = run(SCRIPT, noFuture);
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
  expect(r.out.trim()).toBe("Nothing to shift: today still has content");
  expect(r.text).toBe(FIXTURE);
});

test("a --shift-only after the page turned has nothing left to do", () => {
  // The roll already turned the page, and the day it promoted has not started.
  const first = run(SCRIPT, FIXTURE);
  const r = exec(SCRIPT, first.path, ["--shift-only", "--verbose"]);
  expect(r.out.trim()).toBe(
    "Nothing to shift: today is Thursday 17 September, which has not started",
  );
  const focus = r.text.slice(
    r.text.indexOf("## Focus"),
    r.text.indexOf("## Initiatives"),
  );
  expect(focus.split("\n").filter((x) => /^### /.test(x))).toHaveLength(1);
});

/* ------------------------------------------------------------ safety rails */

test("says so and writes nothing when there is nothing to do", () => {
  const empty = `# Dashboard\n\n## Focus\n\n> [!note]- Tomorrow\n\n> [!note]- Future\n\n## Initiatives\n`;
  const r = run(SCRIPT, empty);
  expect(r.out.trim()).toBe("Nothing to roll: Tomorrow is empty");
  expect(r.text).toBe(empty);
});

test("is idempotent: a second run does not roll tomorrow's work again", () => {
  const first = run(SCRIPT, FIXTURE);
  const second = exec(SCRIPT, first.path);
  expect(second.out.trim()).toBe(
    "Nothing to roll: today is Thursday 17 September, which has not started",
  );
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
  // The created day is the next working day, and the same run promotes it.
  const today = todayOf(r.text);
  expect(today).toContain("### Thursday 17 September");
  expect(today).toContain("🧾 Admin thing");
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

test("says which file is missing rather than failing on the read", () => {
  // Existence is no longer checked before the read, so the read's own ENOENT
  // has to carry the message.
  const dir = mkdtempSync(join(tmpdir(), "roll-"));
  const r = exec(SCRIPT, join(dir, "Gone.md"));
  expect(r.code).toBe(1);
  expect(r.err).toContain("no dashboard at");
});

test("fails loudly when there is no Focus section", () => {
  const r = run(SCRIPT, "# Dashboard\n\n## Initiatives\n\nNothing here.\n");
  expect(r.code).toBe(1);
  expect(r.err).toContain("Focus");
});

/* ------------------------------------------- intentions are day-scoped prose */

/** Today holds one client, its intention, and open items — nothing ticked. */
const INTENTION_ONLY = `# Dashboard

## Focus

### Wednesday 16 September

#### **Acme**

> [!note] Intention: three things and nothing else.

- [ ] First open thing
- [ ] Second open thing

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

## Initiatives

Untouched.
`;

test("an intention never carries to the next day: it goes to the work log", () => {
  const r = run(SCRIPT, INTENTION_ONLY, ["--verbose"]);
  expect(r.code).toBe(0);
  expect(r.text).not.toContain("Intention: three things and nothing else.");
  expect(workLog(r.path)).toContain(
    "Intention: three things and nothing else.",
  );
});

test("filing the intention lets the same run turn the page", () => {
  const r = run(SCRIPT, INTENTION_ONLY, ["--verbose"]);
  expect(r.out).toContain("promoted to today: Thursday 17 September");
  expect(r.out).toContain("new tomorrow: Friday 18 September");
  expect(r.text).toContain("### Thursday 17 September");
  expect(r.text).not.toContain("### Wednesday 16 September");
});

test("an end-of-day overview is a record, so it goes to the work log", () => {
  const overview = INTENTION_ONLY.replace(
    "> [!note] Intention: three things and nothing else.",
    "> [!note] Two of the three landed. **Watch:** the third needs Magnus.",
  );
  const r = run(SCRIPT, overview, ["--verbose"]);
  expect(r.text).not.toContain("**Watch:** the third needs Magnus.");
  expect(workLog(r.path)).toContain("**Watch:** the third needs Magnus.");
  expect(r.out).toContain("promoted to today: Thursday 17 September");
});

test("a handover callout beside the intention does not hold the day open", () => {
  const handover = INTENTION_ONLY.replace(
    "> [!note] Intention: three things and nothing else.",
    "> [!note] Intention: three things and nothing else.\n\n> [!abstract] **[[Handover — follow-ups]]** — for the next session",
  );
  const r = run(SCRIPT, handover, ["--verbose"]);
  expect(r.out).toContain("promoted to today: Thursday 17 September");
  expect(r.text).not.toContain("### Wednesday 16 September");
  expect(workLog(r.path)).toContain("[[Handover — follow-ups]]");
});

test("a multi-line intention is filed whole, continuation lines included", () => {
  const wrapped = INTENTION_ONLY.replace(
    "> [!note] Intention: three things and nothing else.",
    "> [!note] Intention: three things and nothing else.\n> The rest moved to Thursday.",
  );
  const r = run(SCRIPT, wrapped, ["--verbose"]);
  expect(r.text).not.toContain("The rest moved to Thursday.");
  expect(workLog(r.path)).toContain("The rest moved to Thursday.");
  expect(r.out).toContain("promoted to today: Thursday 17 September");
});

/* ------------------------------------------------- band headers (6 Oct) */

// On 6 Oct a wrapped line of the maintenance note began with the band's own
// text, and the scripts took it for the Tomorrow band. A band header is the
// whole line and nothing else.
const PROSE_FIXTURE = FIXTURE.replace(
  "> Prose that must never move.",
  "> - **Three bands.** Tomorrow holds one day in a collapsed\n" +
    "> [!note]- Tomorrow`, and stays even when empty.\n" +
    "> Prose that must never move.",
).replace(
  "- [ ] Globex open thing",
  "- [ ] Globex open thing\n\n> [!note]- Handover\n> Notes for the next session.",
);

test("a prose line that starts with the band text is not the Tomorrow band", () => {
  const r = run(SCRIPT, PROSE_FIXTURE);
  expect(r.code).toBe(0);
  // The maintenance note is unchanged, wrapped line included.
  expect(r.text).toContain(
    "> [!note]- How to maintain this Focus log (for editors)\n>\n> - **Three bands.** Tomorrow holds one day in a collapsed\n> [!note]- Tomorrow`, and stays even when empty.\n> Prose that must never move.",
  );
  // The real Tomorrow band was used: Thursday became today, with the rolled
  // items, and Friday moved up into Tomorrow.
  const realBand = r.text.indexOf("\n> [!note]- Tomorrow\n");
  expect(realBand).toBeGreaterThan(0);
  const today = r.text.slice(r.text.search(/^### /m), realBand);
  expect(today).toContain("### Thursday 17 September");
  expect(today).toContain("- [ ] Globex open thing");
  expect(r.text.slice(realBand)).toContain("> ### Friday 18 September");
});

test("a collapsed callout inside a day stays with that day", () => {
  // Under the old prefix match, "> [!note]- Handover" ended the day, so the
  // note was cut off from it. Now it belongs to the day and goes to the work
  // log with it when the day is filed.
  const r = run(SCRIPT, PROSE_FIXTURE);
  expect(r.text).not.toContain("> [!note]- Handover");
  expect(workLog(r.path)).toContain("Notes for the next session.");
});
