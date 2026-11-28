import { afterEach, beforeEach, expect, test } from "bun:test";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  appendEntry,
  buildEntry,
  detectionScore,
  type Entry,
  knownModes,
  markSent,
  merge,
  occurrenceScore,
  pending,
  readExport,
  readLog,
  renderReview,
  review,
  setSeverity,
  severitiesFromExport,
  skillFromDir,
  validate,
} from "./outcome-log";

const SCRIPT = join(import.meta.dir, "outcome-log.ts");
const NOW = new Date("2026-11-28T10:15:02.123Z");
let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "outcome-log-test-"));
});
afterEach(() => rmSync(root, { force: true, recursive: true }));

const ok = { outcome: "ok", skill: "expenses@1.4.0" } as const;
const corrected = {
  cause: "Duplicate check compares amount only (confirmed)",
  cost: "6 min",
  detected: "review",
  fix: "skill-script",
  mode: "creates-duplicate",
  outcome: "corrected",
  skill: "expenses@1.4.0",
  what: "Created a second expense for a receipt already imported",
} as const;

/** `n` entries for one skill, dated one per day, for scoring tests. */
function runs(
  n: number,
  fields: Partial<Entry>,
  start = 0,
  skill = "expenses@1.4.0",
): Entry[] {
  return Array.from({ length: n }, (_, i) => ({
    cause: "",
    cost: "",
    date: `2026-11-${String(((start + i) % 28) + 1).padStart(2, "0")}`,
    detected: "",
    fix: "",
    id: `${skill}-${fields.mode ?? "ok"}-${start + i}`,
    loggedAt: "2026-11-01T00:00:00.000Z",
    mode: "",
    outcome: "ok" as const,
    skill,
    what: "",
    ...fields,
  }));
}

// -------------------------------------------------------------- validation

test("an ok entry and a corrected entry are valid", () => {
  expect(validate(ok)).toEqual([]);
  expect(validate(corrected)).toEqual([]);
});

test("a failed or corrected run needs a mode, what and detected", () => {
  const problems = validate({ outcome: "failed", skill: "expenses" });
  expect(problems).toContain("a failed run needs a mode");
  expect(problems).toContain("a failed run needs what");
  expect(problems).toContain("a failed run needs detected");
});

test("an ok run carries no failure fields", () => {
  expect(validate({ ...ok, mode: "creates-duplicate" })).toEqual([
    "an ok run has no mode, what or detected",
  ]);
});

test("values outside the fixed lists are refused", () => {
  expect(validate({ ...ok, outcome: "fine" as never })).toHaveLength(1);
  expect(validate({ ...corrected, detected: "luck" })).toHaveLength(1);
  expect(validate({ ...corrected, fix: "somewhere" })).toHaveLength(1);
  expect(validate({ ...corrected, mode: "Creates Duplicate" })).toHaveLength(1);
  expect(validate({ ...ok, skill: "Not A Skill" })).toHaveLength(1);
  expect(validate({ ...ok, date: "28/11/2026" })).toHaveLength(1);
});

test("free text is one line and bounded", () => {
  expect(validate({ ...corrected, what: "two\nlines" })).toEqual([
    "what must be one line",
  ]);
  expect(validate({ ...corrected, cause: "x".repeat(301) })).toEqual([
    "cause must be at most 300 characters",
  ]);
});

test("a plugin skill name with a version is accepted", () => {
  expect(validate({ outcome: "ok", skill: "mail:junk@0.2.0" })).toEqual([]);
});

test("the entry gets a sortable id, the timestamp and a default date", () => {
  const e = buildEntry(
    { outcome: "ok", skill: "mail:junk@0.2.0" },
    NOW,
    "ab12",
  );
  expect(e.id).toBe("20261128T101502Z-mail.junk-ab12");
  expect(e.loggedAt).toBe("2026-11-28T10:15:02.123Z");
  expect(e.date).toMatch(/^2026-11-2[89]$/);
  expect(e.what).toBe("");
  expect(() => buildEntry({ outcome: "failed", skill: "x" })).toThrow();
});

test("a skill is named from its plugin manifest", () => {
  const skillDir = join(root, "plugins", "mail", "skills", "junk");
  mkdirSync(skillDir, { recursive: true });
  mkdirSync(join(root, "plugins", "mail", ".claude-plugin"));
  writeFileSync(
    join(root, "plugins", "mail", ".claude-plugin", "plugin.json"),
    JSON.stringify({ name: "mail", version: "0.2.0" }),
  );
  expect(skillFromDir(skillDir)).toBe("mail:junk@0.2.0");
  const loose = join(root, "loose", "tidy");
  mkdirSync(loose, { recursive: true });
  expect(skillFromDir(loose)).toBe("tidy");
});

// ------------------------------------------------------------------- store

test("append writes one line per entry and reads them back", () => {
  appendEntry(ok, root, NOW, "0001");
  appendEntry(corrected, root, NOW, "0002");
  const { entries, skipped } = readLog(root);
  expect(skipped).toBe(0);
  expect(entries.map((e) => e.outcome)).toEqual(["ok", "corrected"]);
  expect(entries[1].mode).toBe("creates-duplicate");
  expect(existsSync(join(root, "outbox"))).toBe(false);
});

test("an invalid entry writes nothing", () => {
  expect(() => appendEntry({ outcome: "failed", skill: "x" }, root)).toThrow();
  expect(readLog(root).entries).toEqual([]);
});

test("unreadable lines are counted, not dropped silently", () => {
  appendEntry(ok, root, NOW, "0001");
  writeFileSync(join(root, "log.jsonl"), "not json\n{}\n", { flag: "a" });
  const { entries, skipped } = readLog(root);
  expect(entries).toHaveLength(1);
  expect(skipped).toBe(2);
});

test("with an artifact configured, each entry is queued as its document", () => {
  writeFileSync(
    join(root, "config.json"),
    JSON.stringify({ artifact: "https://example.test/a", origin: "laptop" }),
  );
  const { entry, outboxFile } = appendEntry(corrected, root, NOW, "0002");
  expect(entry.origin).toBe("laptop");
  const doc = JSON.parse(readFileSync(outboxFile!, "utf8"));
  expect(doc.id).toBeUndefined();
  expect(doc.mode).toBe("creates-duplicate");
  expect(pending(root).writes).toEqual([
    {
      collection: "runs",
      doc_id: entry.id,
      file_path: outboxFile!,
      op: "set",
    },
  ]);
});

test("pending drops entries the export already holds, and sent clears the rest", () => {
  writeFileSync(
    join(root, "config.json"),
    JSON.stringify({ artifact: "https://example.test/a" }),
  );
  const a = appendEntry(ok, root, NOW, "0001").entry;
  const b = appendEntry(corrected, root, NOW, "0002").entry;
  const exported = join(root, "export");
  mkdirSync(join(exported, "runs"), { recursive: true });
  writeFileSync(join(exported, "runs", `${a.id}.json`), JSON.stringify(ok));

  const p = pending(root, exported);
  expect(p.alreadyThere).toEqual([a.id]);
  expect(p.writes.map((w) => w.doc_id)).toEqual([b.id]);
  expect(markSent([b.id, "never-queued"], root)).toEqual([b.id]);
  expect(readdirSync(join(root, "outbox"))).toEqual([]);
  expect(readLog(root).entries).toHaveLength(2);
});

test("an export is read with the file name as the id, and merged by id", () => {
  const local = appendEntry(ok, root, NOW, "0001").entry;
  const exported = join(root, "export");
  mkdirSync(join(exported, "runs"), { recursive: true });
  writeFileSync(join(exported, "runs", `${local.id}.json`), JSON.stringify(ok));
  writeFileSync(
    join(exported, "runs", "20261101T000000Z-expenses-ffff.json"),
    JSON.stringify({ ...corrected, date: "2026-11-01" }),
  );
  const all = merge(readExport(exported), readLog(root).entries);
  expect(all.map((e) => e.id)).toEqual([
    "20261101T000000Z-expenses-ffff",
    local.id,
  ]);
});

// ------------------------------------------------------------------ scoring

test("occurrence rises with the failure rate", () => {
  expect(occurrenceScore(0.004)).toBe(1);
  expect(occurrenceScore(0.01)).toBe(2);
  expect(occurrenceScore(0.02)).toBe(3);
  expect(occurrenceScore(0.05)).toBe(4);
  expect(occurrenceScore(0.1)).toBe(5);
  expect(occurrenceScore(0.2)).toBe(6);
  expect(occurrenceScore(0.33)).toBe(7);
  expect(occurrenceScore(0.5)).toBe(8);
  expect(occurrenceScore(0.75)).toBe(9);
  expect(occurrenceScore(0.76)).toBe(10);
  expect(occurrenceScore(1)).toBe(10);
});

test("detection is the mean of how each failure was found", () => {
  expect(detectionScore(["check"])).toBe(2);
  expect(detectionScore(["review"])).toBe(5);
  expect(detectionScore(["later-use"])).toBe(8);
  expect(detectionScore(["check", "later-use"])).toBe(5);
  expect(detectionScore(["check", "check", "review"])).toBe(3);
  expect(detectionScore([])).toBe(5);
});

test("a review multiplies the three scores and ranks by the product", () => {
  const entries = [
    ...runs(44, {}),
    // 5 of 50 runs: rate 0.1, occurrence 5. Found by review: detection 5.
    ...runs(
      5,
      {
        detected: "review",
        mode: "creates-duplicate",
        outcome: "corrected",
        what: "dup",
      },
      44,
    ),
    // 1 of 50 runs: rate 0.02, occurrence 3. Found later: detection 8.
    ...runs(
      1,
      {
        detected: "later-use",
        mode: "wrong-category",
        outcome: "failed",
        what: "cat",
      },
      49,
    ),
  ];
  const r = review(
    entries,
    {
      expenses: {
        "creates-duplicate": { severity: 4 },
        "wrong-category": { severity: 9 },
      },
    },
    { now: NOW },
  );
  expect(r.skills).toEqual([
    { corrected: 5, failed: 1, ok: 44, runs: 50, skill: "expenses" },
  ]);
  expect(
    r.modes.map((m) => [m.mode, m.severity, m.occurrence, m.detection, m.rpn]),
  ).toEqual([
    ["wrong-category", 9, 3, 8, 216],
    ["creates-duplicate", 4, 5, 5, 100],
  ]);
  expect(r.modes[0].highSeverity).toBe(true);
  expect(r.modes[0].lever).toBe("detection");
  expect(r.modes[1].highSeverity).toBe(false);
  expect(r.modes[0].lowSample).toBe(false);
  expect(r.unscored).toEqual([]);
});

test("occurrence is the lever when the mode is frequent and always caught", () => {
  const entries = [
    ...runs(10, {}),
    ...runs(
      10,
      {
        detected: "check",
        mode: "count-mismatch",
        outcome: "failed",
        what: "x",
      },
      10,
    ),
  ];
  const [m] = review(entries, {
    expenses: { "count-mismatch": { severity: 3 } },
  }).modes;
  expect([m.occurrence, m.detection, m.rpn, m.lever]).toEqual([
    8,
    2,
    48,
    "occurrence",
  ]);
});

test("a mode without a severity is listed but not ranked", () => {
  const entries = [
    ...runs(3, {}),
    ...runs(
      1,
      {
        detected: "review",
        mode: "creates-duplicate",
        outcome: "corrected",
        what: "dup",
      },
      3,
    ),
  ];
  const r = review(entries);
  expect(r.modes).toEqual([]);
  expect(r.unscored).toHaveLength(1);
  expect(r.unscored[0].rpn).toBeNull();
  expect(r.unscored[0].lowSample).toBe(true);
  expect(renderReview(r)).toContain("no severity yet");
});

test("versions of one skill are counted together, and skills apart", () => {
  const entries = [
    ...runs(2, {}, 0, "expenses@1.4.0"),
    ...runs(2, {}, 2, "expenses@1.5.0"),
    ...runs(
      1,
      { detected: "check", mode: "no-token", outcome: "failed", what: "x" },
      4,
      "mail:junk@0.2.0",
    ),
  ];
  const r = review(entries);
  expect(r.skills).toEqual([
    { corrected: 0, failed: 0, ok: 4, runs: 4, skill: "expenses" },
    { corrected: 0, failed: 1, ok: 0, runs: 1, skill: "mail:junk" },
  ]);
  expect(review(entries, {}, { skill: "mail:junk@9.9.9" }).skills).toHaveLength(
    1,
  );
});

test("a date window limits both the runs and the failures", () => {
  const entries = [
    ...runs(10, {}),
    ...runs(
      1,
      {
        date: "2026-10-15",
        detected: "review",
        mode: "creates-duplicate",
        outcome: "corrected",
        what: "dup",
      },
      10,
    ),
  ];
  const r = review(entries, {}, { from: "2026-11-01" });
  expect(r.skills[0].runs).toBe(10);
  expect(r.unscored).toEqual([]);
  expect(review(entries, {}, { to: "2026-10-31" }).skills[0].runs).toBe(1);
});

test("equal products fall back to severity, then count", () => {
  const entries = [
    ...runs(8, {}),
    ...runs(
      1,
      { detected: "review", mode: "a-mode", outcome: "failed", what: "x" },
      8,
    ),
    ...runs(
      1,
      { detected: "review", mode: "b-mode", outcome: "failed", what: "x" },
      9,
    ),
  ];
  const r = review(entries, {
    expenses: { "a-mode": { severity: 5 }, "b-mode": { severity: 5 } },
  });
  expect(r.modes.map((m) => m.mode)).toEqual(["a-mode", "b-mode"]);
  expect(r.modes[0].rpn).toBe(r.modes[1].rpn);
});

test("known modes are listed per skill, most frequent first", () => {
  const entries = [
    ...runs(2, {
      detected: "review",
      mode: "creates-duplicate",
      outcome: "corrected",
      what: "x",
    }),
    ...runs(
      1,
      {
        detected: "review",
        mode: "wrong-category",
        outcome: "corrected",
        what: "x",
      },
      2,
    ),
    ...runs(
      1,
      { detected: "check", mode: "no-token", outcome: "failed", what: "x" },
      3,
      "mail:junk@0.2.0",
    ),
  ];
  expect(knownModes(entries, "expenses@2.0.0")).toEqual([
    { count: 2, mode: "creates-duplicate", skill: "expenses" },
    { count: 1, mode: "wrong-category", skill: "expenses" },
  ]);
  expect(knownModes(entries)).toHaveLength(3);
});

test("severity is stored per skill and mode, and refused outside 1 to 10", () => {
  setSeverity(
    "expenses@1.4.0",
    "creates-duplicate",
    4,
    "costs a correction",
    root,
  );
  const all = setSeverity("expenses", "wrong-category", 9, undefined, root);
  expect(all).toEqual({
    expenses: {
      "creates-duplicate": { note: "costs a correction", severity: 4 },
      "wrong-category": { severity: 9 },
    },
  });
  expect(() => setSeverity("expenses", "x", 11, undefined, root)).toThrow();
  expect(() => setSeverity("expenses", "x", 2.5, undefined, root)).toThrow();
});

test("severities come from the latest stored review in an export", () => {
  const reviews = join(root, "export", "reviews");
  mkdirSync(reviews, { recursive: true });
  const mode = (severity: number) => ({
    mode: "creates-duplicate",
    severity,
    skill: "expenses",
  });
  writeFileSync(
    join(reviews, "2026-10-01.json"),
    JSON.stringify({ date: "2026-10-01", modes: [mode(3)] }),
  );
  writeFileSync(
    join(reviews, "2026-11-01.json"),
    JSON.stringify({ date: "2026-11-01", modes: [mode(6)] }),
  );
  expect(severitiesFromExport(join(root, "export"))).toEqual({
    expenses: { "creates-duplicate": { severity: 6 } },
  });
  expect(severitiesFromExport(join(root, "nothing-here"))).toEqual({});
});

// --------------------------------------------------------------------- cli

function cli(...args: string[]) {
  const p = Bun.spawnSync(["bun", SCRIPT, ...args], {
    env: { ...process.env, SKILL_FEEDBACK_HOME: root },
  });
  return {
    code: p.exitCode,
    err: p.stderr.toString(),
    out: p.stdout.toString(),
  };
}

test("the command line appends, scores and reviews end to end", () => {
  const skillDir = join(root, "plugins", "mail", "skills", "junk");
  mkdirSync(skillDir, { recursive: true });
  mkdirSync(join(root, "plugins", "mail", ".claude-plugin"));
  writeFileSync(
    join(root, "plugins", "mail", ".claude-plugin", "plugin.json"),
    JSON.stringify({ name: "mail", version: "0.2.0" }),
  );

  const first = cli(
    "append",
    "--skill-dir",
    skillDir,
    "--outcome",
    "ok",
    "--cost",
    "2 min",
  );
  expect(first.code).toBe(0);
  expect(JSON.parse(first.out).entry.skill).toBe("mail:junk@0.2.0");

  const second = cli(
    "append",
    "--skill",
    "mail:junk@0.2.0",
    "--outcome",
    "corrected",
    "--mode",
    "wrong-verdict-delete",
    "--what",
    "Proposed deleting a message the operator moved to rescue",
    "--detected",
    "review",
    "--fix",
    "config",
  );
  expect(second.code).toBe(0);

  const bad = cli("append", "--skill", "mail:junk", "--outcome", "failed");
  expect(bad.code).toBe(1);
  expect(bad.err).toContain("a failed run needs a mode");

  expect(cli("severity", "mail:junk", "wrong-verdict-delete", "9").code).toBe(
    0,
  );
  const out = join(root, "review.json");
  const reviewed = cli("review", "--out", out);
  expect(reviewed.code).toBe(0);
  // 1 of 2 runs: occurrence 8. Found by review: detection 5. 9 x 8 x 5 = 360.
  expect(reviewed.out).toContain(
    "| mail:junk | wrong-verdict-delete | 1/2 | 9 | 8 | 5 | 360 | occurrence | severity 9 or 10, fewer than 20 runs |",
  );
  expect(JSON.parse(readFileSync(out, "utf8")).modes[0].rpn).toBe(360);

  expect(JSON.parse(cli("modes", "--skill", "mail:junk").out)).toEqual([
    { count: 1, mode: "wrong-verdict-delete", skill: "mail:junk" },
  ]);
  expect(JSON.parse(cli("config").out).entries).toBe(2);
});
