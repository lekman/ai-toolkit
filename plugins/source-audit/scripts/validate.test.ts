import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  checkFindings,
  checkRun,
  checkTogether,
  isRepoPath,
  RULES,
  safe,
  summarise,
  validateFolder,
} from "./validate.mjs";

const COMMIT = "33df8b3b4b18c9da693fe1742e4a01f738e0be02";
const SCRIPT = join(import.meta.dir, "validate.mjs");

type Json = Record<string, unknown>;

const trace = () => [
  {
    file: "src/routes/notes.js",
    kind: "entrypoint",
    line: 28,
    note: "Any signed-in user gives a note id.",
  },
  {
    file: "src/routes/notes.js",
    kind: "sink",
    line: 29,
    note: "The note is read with no owner check.",
  },
];

const confirmed = (extra: Json = {}): Json => ({
  attacker: "A signed-in user with their own account.",
  boundary: "Only the owner may read a note.",
  description: "Reading a note by id returns it to any signed-in user.",
  evidence:
    "The read handler queries by id alone, and the owner helper is not called.",
  fingerprint: "notes-read-no-owner-check",
  fix: "Use the owner helper in the read handler.",
  found_by: "hunter",
  method: "source",
  result: "Another user's note is returned.",
  root_cause: "The read handler omits the owner check.",
  severity: "high",
  severity_reason: "Every note of every user can be read.",
  title: "Note read has no owner check",
  trace: trace(),
  verdict: "confirmed",
  verified_by: "verifier-1",
  ...extra,
});

const lead = (extra: Json = {}): Json => ({
  blocker:
    "Whether a proxy in front of the service strips the header is not in the repository.",
  description: "The service trusts a forwarded header for the client address.",
  fingerprint: "proxy-header-trust",
  found_by: "hunter",
  plan: "Ask the owner of the proxy whether it removes the header from outside requests.",
  root_cause: "The address used for rate limits may come from the client.",
  title: "Forwarded header may be trusted",
  trace: [trace()[0]],
  verdict: "needs_validation",
  verified_by: "verifier-1",
  ...extra,
});

const rejected = (extra: Json = {}): Json => ({
  description: "The sort parameter was thought to reach the query as text.",
  fingerprint: "sort-injection",
  found_by: "hunter",
  reason: "The value is looked up in a fixed list before it reaches the query.",
  root_cause: "The sort order was thought to be taken from the request.",
  title: "Sort parameter injection",
  trace: [trace()[1]],
  verdict: "rejected",
  verified_by: "verifier-2",
  ...extra,
});

const run = (extra: Json = {}): Json => ({
  candidates: [
    "notes-read-no-owner-check",
    "proxy-header-trust",
    "sort-injection",
  ],
  commit: COMMIT,
  dirty: false,
  gaps: [{ area: "src/routes/admin.js", reason: "Not read in this run." }],
  hardening: ["Password hashes use a fast hash."],
  ran_target_code: false,
  reviewed_paths: ["src/routes/notes.js", "src/auth.js"],
  scope: { kind: "repository" },
  status: "complete",
  ...extra,
});

const all = () => [confirmed(), lead(), rejected()];
const rules = (failures: { rule: string }[]) => failures.map((f) => f.rule);

function folder(runValue: unknown, findingsValue: unknown): string {
  const dir = mkdtempSync(join(tmpdir(), "source-audit-"));
  writeFileSync(join(dir, "run.json"), JSON.stringify(runValue));
  writeFileSync(join(dir, "findings.json"), JSON.stringify(findingsValue));
  return dir;
}

describe("a valid run", () => {
  test("passes, and the summary counts each verdict", () => {
    const result = validateFolder(folder(run(), all()), { commit: COMMIT });
    expect(result.failures).toEqual([]);
    expect(result.summary).toEqual({
      commit: COMMIT,
      confirmed: 1,
      gaps: 1,
      highest_confirmed_severity: "high",
      needs_validation: 1,
      ran_target_code: false,
      rejected: 1,
      status: "complete",
    });
  });

  test("a run that found nothing still has to say what it read", () => {
    expect(
      validateFolder(folder(run({ candidates: [] }), [])).failures,
    ).toEqual([]);
    expect(
      summarise(run({ candidates: [] }), []).highest_confirmed_severity,
    ).toBeNull();
    const unread = checkRun(run({ candidates: [], reviewed_paths: [] }));
    expect(unread[0]?.where).toBe("run.json reviewed_paths");
    expect(unread[0]?.rule).toBe("source-audit/run-record");
  });
});

describe("the run record", () => {
  test("needs a full commit, not a short one", () => {
    const failures = checkRun(run({ commit: "33df8b3" }));
    expect(failures).toHaveLength(1);
    expect(failures[0]?.change).toContain("40 lower case hex characters");
  });

  test("an incomplete run says why", () => {
    expect(rules(checkRun(run({ status: "incomplete" })))).toEqual([
      "source-audit/run-record",
    ]);
    expect(
      checkRun(
        run({ incomplete_reason: "The budget ran out.", status: "incomplete" }),
      ),
    ).toEqual([]);
  });

  test("a scope of paths or a diff carries its detail", () => {
    expect(checkRun(run({ scope: { kind: "paths" } }))[0]?.where).toBe(
      "run.json scope.paths",
    );
    expect(checkRun(run({ scope: { kind: "diff" } }))[0]?.where).toBe(
      "run.json scope.base",
    );
    expect(checkRun(run({ scope: { base: COMMIT, kind: "diff" } }))).toEqual(
      [],
    );
  });

  test("running the target has to be declared with what isolated it", () => {
    const failures = checkRun(run({ ran_target_code: true }));
    expect(rules(failures)).toEqual(["source-audit/ran-code"]);
    expect(failures[0]?.where).toBe("run.json isolation");
    expect(
      checkRun(
        run({
          isolation: "A container with one sample repository.",
          ran_target_code: true,
        }),
      ),
    ).toEqual([]);
  });
});

describe("the records", () => {
  test("a record needs the fields of its verdict and no others", () => {
    const noSeverity = checkFindings([confirmed({ severity: undefined })]);
    expect(noSeverity[0]?.where).toBe("findings.json $[0].severity");
    expect(noSeverity[0]?.rule).toBe("source-audit/verdict-fields");

    const leadWithSeverity = checkFindings([lead({ severity: "high" })]);
    expect(leadWithSeverity[0]?.change).toBe(
      "remove it, a needs_validation record does not carry this field",
    );

    expect(rules(checkFindings([rejected({ fix: "Change it." })]))).toEqual([
      "source-audit/verdict-fields",
    ]);
    expect(rules(checkFindings([confirmed({ severity: "severe" })]))).toEqual([
      "source-audit/verdict-fields",
    ]);
  });

  test("the agent that checks a record is not the one that found it", () => {
    const failures = checkFindings([confirmed({ verified_by: "hunter" })]);
    expect(rules(failures)).toEqual(["source-audit/independent-check"]);
    expect(failures[0]?.where).toBe("findings.json $[0].verified_by");
  });

  test("records are sorted by fingerprint and each appears once", () => {
    expect(rules(checkFindings([lead(), confirmed()]))).toEqual([
      "source-audit/order",
    ]);
    expect(rules(checkFindings([confirmed(), confirmed()]))).toEqual([
      "source-audit/order",
    ]);
  });

  test("a trace runs from an entry to a sink through real places", () => {
    const backwards = [trace()[1], trace()[0]];
    expect(rules(checkFindings([confirmed({ trace: backwards })]))).toEqual([
      "source-audit/trace",
      "source-audit/trace",
    ]);
    const outside = [{ ...trace()[0], file: "../etc/passwd" }, trace()[1]];
    expect(checkFindings([confirmed({ trace: outside })])[0]?.where).toBe(
      "findings.json $[0].trace[0].file",
    );
    const lineZero = [{ ...trace()[0], line: 0 }, trace()[1]];
    expect(checkFindings([confirmed({ trace: lineZero })])[0]?.where).toBe(
      "findings.json $[0].trace[0].line",
    );
    expect(rules(checkFindings([confirmed({ trace: [] })]))).toEqual([
      "source-audit/trace",
    ]);
  });

  test("a check made by running the target lists its steps", () => {
    expect(rules(checkFindings([confirmed({ method: "local" })]))).toEqual([
      "source-audit/ran-code",
    ]);
    expect(
      checkFindings([
        confirmed({
          method: "local",
          steps: ["Start the service.", "Request note 1."],
        }),
      ]),
    ).toEqual([]);
  });
});

describe("the two files together", () => {
  test("a candidate with no record fails a complete run and passes an incomplete one", () => {
    const dropped = checkTogether(run(), [confirmed()]);
    expect(rules(dropped)).toEqual([
      "source-audit/no-dropped-lead",
      "source-audit/no-dropped-lead",
    ]);
    expect(dropped[0]?.where).toBe("run.json candidates proxy-header-trust");
    expect(
      checkTogether(
        run({ incomplete_reason: "Stopped.", status: "incomplete" }),
        [confirmed()],
      ),
    ).toEqual([]);
  });

  test("a record that was never a candidate fails", () => {
    const failures = checkTogether(run({ candidates: [] }), [confirmed()]);
    expect(failures[0]?.where).toBe("findings.json notes-read-no-owner-check");
  });

  test("a record made by running the target needs the run to say so", () => {
    const record = confirmed({ method: "local", steps: ["Request note 1."] });
    const failures = checkTogether(run({ candidates: [record.fingerprint] }), [
      record,
    ]);
    expect(rules(failures)).toEqual(["source-audit/ran-code"]);
  });

  test("the commit is the one the caller asked for", () => {
    const other = "a".repeat(40);
    const failures = checkTogether(run(), all(), { commit: other });
    expect(rules(failures)).toEqual(["source-audit/commit"]);
    expect(failures[0]?.change).toContain(COMMIT);
  });
});

describe("the command line", () => {
  const cli = (...args: string[]) =>
    spawnSync("node", [SCRIPT, ...args], { encoding: "utf8" });

  test("prints a summary line and exits 0 on a valid run", () => {
    const result = cli(folder(run(), all()), "--commit", COMMIT);
    expect(result.status).toBe(0);
    expect(result.stdout).toBe(
      "PASS: 1 confirmed, 1 needs_validation, 1 rejected, 1 gap(s), highest confirmed severity high, run complete\n",
    );
  });

  test("prints the summary as JSON for a gate", () => {
    const result = cli(folder(run(), all()), "--json");
    expect(JSON.parse(result.stdout).highest_confirmed_severity).toBe("high");
  });

  test("each failure says where, what to change, which rule and where to read more", () => {
    const result = cli(folder(run(), [lead({ severity: "high" })]));
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      "findings.json $[0].severity: remove it, a needs_validation record does not carry this field.\n" +
        "  Rule: source-audit/verdict-fields\n" +
        "  Docs: https://github.com/lekman/ai-toolkit/blob/main/plugins/source-audit/README.md#each-verdict-has-its-own-fields",
    );
  });

  test("a missing file, a link and broken JSON each fail with the files rule", () => {
    const empty = mkdtempSync(join(tmpdir(), "source-audit-"));
    expect(rules(validateFolder(empty).failures)).toEqual([
      "source-audit/files",
      "source-audit/files",
    ]);

    const linked = mkdtempSync(join(tmpdir(), "source-audit-"));
    const real = folder(run(), all());
    symlinkSync(join(real, "run.json"), join(linked, "run.json"));
    writeFileSync(join(linked, "findings.json"), "[");
    const failures = validateFolder(linked).failures;
    expect(failures.map((f) => f.change)).toEqual([
      "make it a regular file, not a link or a folder",
      "make it valid JSON",
    ]);
  });

  test("asks for usage when no folder is given or the commit is short", () => {
    expect(cli().status).toBe(2);
    expect(cli(folder(run(), all()), "--commit", "33df8b3").status).toBe(2);
  });
});

describe("helpers", () => {
  test("a repository path cannot leave the repository", () => {
    for (const good of ["src/a.js", "README.md", "a/b/c.ts"])
      expect(isRepoPath(good)).toBe(true);
    for (const bad of [
      "/etc/passwd",
      "../a",
      "a/../b",
      "a//b",
      "~/a",
      "C:/a",
      "a\\b",
      "",
      " a",
      3,
    ]) {
      expect(isRepoPath(bad)).toBe(false);
    }
  });

  test("text from a record is printed with control characters escaped", () => {
    expect(safe("a\u001b[31mb\u202e")).toBe("a\\u001b[31mb\\u202e");
    expect(safe("x".repeat(200))).toHaveLength(123);
  });
});

describe("the README", () => {
  test("has a heading for every rule a failure can link to", () => {
    const readme = readFileSync(
      join(import.meta.dir, "..", "README.md"),
      "utf8",
    );
    const anchors = readme
      .split("\n")
      .filter((line) => line.startsWith("#"))
      .map((line) =>
        line
          .replace(/^#+\s*/, "")
          .toLowerCase()
          .replace(/[^a-z0-9 -]/g, "")
          .replaceAll(" ", "-"),
      );
    for (const anchor of Object.values(RULES))
      expect(anchors).toContain(anchor);
  });
});
