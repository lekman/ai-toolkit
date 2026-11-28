#!/usr/bin/env node
/**
 * Check one source audit run folder: run.json and findings.json.
 *
 *   node validate.mjs <run-folder> [--commit <sha>] [--json]
 *
 * Exit status 0 means the records are well formed and agree with each other.
 * It says nothing about severity. A gate that blocks a release reads the
 * summary this prints, or findings.json itself, and applies its own policy.
 *
 * Plain JavaScript with no dependencies, so it runs under Node in a bare
 * container as well as under Bun. The record shape and several of the checks
 * are adapted from cloudflare/security-audit-skill (MIT). See the README.
 */

import {
  closeSync,
  constants,
  fstatSync,
  openSync,
  readFileSync,
} from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const DOCS =
  "https://github.com/lekman/ai-toolkit/blob/main/plugins/source-audit/README.md";

/** Each rule a failure can name, with the README heading that explains it. */
export const RULES = {
  commit: "the-commit-is-the-one-asked-for",
  files: "the-run-folder-holds-two-files",
  "independent-check": "a-second-agent-checks-every-record",
  "no-dropped-lead": "no-candidate-is-dropped",
  order: "records-are-sorted-and-unique",
  "ran-code": "running-the-target-is-declared",
  "record-fields": "every-record-has-the-common-fields",
  "run-record": "the-run-record-is-complete",
  trace: "the-trace-points-at-real-places",
  "verdict-fields": "each-verdict-has-its-own-fields",
};

export const SEVERITIES = [
  "informational",
  "low",
  "medium",
  "high",
  "critical",
];
export const VERDICTS = ["confirmed", "needs_validation", "rejected"];
export const PASSES = ["first-pass", "second-pass", "both"];

const MAX_BYTES = 5 * 1024 * 1024;
const MAX_RECORDS = 1000;
const FINGERPRINT = /^[A-Za-z0-9][A-Za-z0-9._:/@+-]*$/;
const FULL_COMMIT = /^[0-9a-f]{40}$/;
const UNSAFE_IN_OUTPUT = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu;

const COMMON = [
  "verdict",
  "fingerprint",
  "title",
  "description",
  "root_cause",
  "trace",
  "found_by",
  "verified_by",
];
const BY_VERDICT = {
  confirmed: [
    "attacker",
    "boundary",
    "result",
    "severity",
    "severity_reason",
    "method",
    "evidence",
    "fix",
  ],
  needs_validation: ["blocker", "plan"],
  rejected: ["reason"],
};
const OPTIONAL = { confirmed: ["steps"], needs_validation: [], rejected: [] };

/**
 * Make text from a record safe to print in a terminal or a build log.
 * @param {unknown} value any value taken from the input
 * @returns {string} the value as text, with control characters escaped
 */
export function safe(value) {
  const text =
    typeof value === "string" ? value : (JSON.stringify(value) ?? "");
  const clipped = text.length > 120 ? `${text.slice(0, 120)}...` : text;
  return clipped.replace(
    UNSAFE_IN_OUTPUT,
    (c) => `\\u${c.codePointAt(0).toString(16).padStart(4, "0")}`,
  );
}

/**
 * Tell whether a path stays inside the repository it is relative to.
 * @param {unknown} value the path as written in a record
 * @returns {boolean} true for a relative path with no way out of the repository
 */
export function isRepoPath(value) {
  if (typeof value !== "string" || value === "" || value.trim() !== value) {
    return false;
  }
  if (/[\p{Cc}\p{Cf}\\:]/u.test(value) || /^[/~]/.test(value)) return false;
  return value
    .split("/")
    .every((part) => part !== "" && part !== "." && part !== "..");
}

const isText = (value) => typeof value === "string" && value.trim() !== "";
// A pattern test turns its argument into text first, so a list holding one
// commit would pass. These check the type before the pattern.
const isCommit = (value) =>
  typeof value === "string" && FULL_COMMIT.test(value);
const isFingerprint = (value) =>
  typeof value === "string" && FINGERPRINT.test(value);
const isObject = (value) =>
  value !== null && typeof value === "object" && !Array.isArray(value);

/**
 * Build one failure. Every failure says where, what to change and which rule.
 * @param {string} where the file and the place in it
 * @param {string} change the edit that repairs it, as an instruction
 * @param {keyof typeof RULES} rule the rule's short name
 * @returns {{where: string, change: string, rule: string, docs: string}} the failure
 */
function failure(where, change, rule) {
  return {
    change,
    docs: `${DOCS}#${RULES[rule]}`,
    rule: `source-audit/${rule}`,
    where,
  };
}

/**
 * Check the run record.
 * @param {unknown} run the parsed run.json
 * @returns {ReturnType<typeof failure>[]} every failure found
 */
export function checkRun(run) {
  const out = [];
  const bad = (field, change, rule = "run-record") =>
    out.push(failure(`run.json ${field}`, change, rule));
  if (!isObject(run)) {
    bad("$", "make it one JSON object");
    return out;
  }
  if (!isCommit(run.commit)) {
    bad(
      "commit",
      "write the full commit, 40 lower case hex characters, from `git rev-parse HEAD`",
    );
  }
  if (typeof run.dirty !== "boolean") {
    bad("dirty", "set it to true or false, from `git status --porcelain`");
  }
  if (
    !isObject(run.scope) ||
    !["repository", "paths", "diff"].includes(run.scope.kind)
  ) {
    bad("scope.kind", 'set it to "repository", "paths" or "diff"');
  } else if (run.scope.kind === "paths" && !pathList(run.scope.paths, false)) {
    bad(
      "scope.paths",
      "list the paths that were in scope, relative to the repository",
    );
  } else if (run.scope.kind === "diff" && !isCommit(run.scope.base)) {
    bad("scope.base", "write the full commit the diff starts from");
  }
  if (!["complete", "incomplete"].includes(run.status)) {
    bad("status", 'set it to "complete" or "incomplete"');
  } else if (run.status === "incomplete" && !isText(run.incomplete_reason)) {
    bad("incomplete_reason", "say why the run stopped early");
  }
  if (typeof run.ran_target_code !== "boolean") {
    bad(
      "ran_target_code",
      "set it to true if any agent ran the target's code, else false",
      "ran-code",
    );
  } else if (run.ran_target_code && !isText(run.isolation)) {
    bad(
      "isolation",
      "say what kept the target's code away from anything of value",
      "ran-code",
    );
  }
  if (!pathList(run.reviewed_paths, false)) {
    bad(
      "reviewed_paths",
      "list every file that was read, relative to the repository",
    );
  }
  if (
    !Array.isArray(run.gaps) ||
    !run.gaps.every((g) => isObject(g) && isText(g.area) && isText(g.reason))
  ) {
    bad(
      "gaps",
      "make it a list of {area, reason}, empty when nothing was left out",
    );
  }
  if (!Array.isArray(run.hardening) || !run.hardening.every(isText)) {
    bad("hardening", "make it a list of notes, empty when there are none");
  }
  if (!Array.isArray(run.candidates) || !run.candidates.every(isFingerprint)) {
    bad(
      "candidates",
      "list the fingerprint of every candidate the hunt produced",
    );
  }
  return out;
}

/**
 * Tell whether a value is a list of repository paths.
 * @param {unknown} value the value to test
 * @param {boolean} allowEmpty whether an empty list passes
 * @returns {boolean} true when every entry is a safe repository path
 */
function pathList(value, allowEmpty) {
  return (
    Array.isArray(value) &&
    (allowEmpty || value.length > 0) &&
    value.every(isRepoPath)
  );
}

/**
 * Check the findings on their own.
 * @param {unknown} findings the parsed findings.json
 * @returns {ReturnType<typeof failure>[]} every failure found
 */
export function checkFindings(findings) {
  const out = [];
  if (!Array.isArray(findings)) {
    return [
      failure(
        "findings.json $",
        "make it a JSON list, empty when nothing was found",
        "record-fields",
      ),
    ];
  }
  if (findings.length > MAX_RECORDS) {
    return [
      failure(
        "findings.json $",
        `split the review, a run holds at most ${MAX_RECORDS} records`,
        "record-fields",
      ),
    ];
  }
  let previous = null;
  const seen = new Set();
  findings.forEach((record, index) => {
    const at = `findings.json $[${index}]`;
    const bad = (field, change, rule) =>
      out.push(failure(`${at}${field}`, change, rule));
    if (!isObject(record)) {
      bad("", "make it one JSON object", "record-fields");
      return;
    }
    if (!VERDICTS.includes(record.verdict)) {
      bad(
        ".verdict",
        `set it to one of ${VERDICTS.join(", ")}`,
        "record-fields",
      );
      return;
    }
    for (const field of COMMON) {
      if (field === "trace" || field === "verdict") continue;
      if (!isText(record[field]))
        bad(`.${field}`, "write it, it cannot be empty", "record-fields");
    }
    checkFingerprint(record, bad, seen, previous);
    if (typeof record.fingerprint === "string") previous = record.fingerprint;
    checkVerdictFields(record, bad);
    checkTrace(record.trace, bad);
    if (isText(record.found_by) && !PASSES.includes(record.found_by)) {
      bad(
        ".found_by",
        `set it to the pass that found it, one of ${PASSES.join(", ")}`,
        "record-fields",
      );
    }
    if (PASSES.includes(record.verified_by)) {
      bad(
        ".verified_by",
        "have an agent that did not hunt check it, and name that agent",
        "independent-check",
      );
    }
  });
  return out;
}

/**
 * Check one record's fingerprint, and its place in the list.
 * @param {Record<string, unknown>} record the record
 * @param {(field: string, change: string, rule: keyof typeof RULES) => void} bad reports a failure
 * @param {Set<string>} seen the fingerprints met so far
 * @param {null | string} previous the fingerprint of the record before this one
 */
function checkFingerprint(record, bad, seen, previous) {
  const fp = record.fingerprint;
  if (typeof fp !== "string") return;
  if (!FINGERPRINT.test(fp)) {
    bad(
      ".fingerprint",
      "use letters, digits and . _ : / @ + - only, starting with a letter or digit",
      "record-fields",
    );
  }
  if (seen.has(fp))
    bad(
      ".fingerprint",
      "merge it with the earlier record that has the same fingerprint",
      "order",
    );
  seen.add(fp);
  if (previous !== null && previous > fp)
    bad(".fingerprint", "sort the records by fingerprint", "order");
}

/**
 * Check the fields that depend on the verdict.
 * @param {Record<string, unknown>} record the record
 * @param {(field: string, change: string, rule: keyof typeof RULES) => void} bad reports a failure
 */
function checkVerdictFields(record, bad) {
  const verdict = /** @type {keyof typeof BY_VERDICT} */ (record.verdict);
  const allowed = new Set([
    ...COMMON,
    ...BY_VERDICT[verdict],
    ...OPTIONAL[verdict],
  ]);
  for (const field of BY_VERDICT[verdict]) {
    if (!isText(record[field])) {
      bad(
        `.${field}`,
        `write it, a ${verdict} record needs it`,
        "verdict-fields",
      );
    }
  }
  for (const field of Object.keys(record)) {
    if (!allowed.has(field)) {
      bad(
        `.${safe(field)}`,
        `remove it, a ${verdict} record does not carry this field`,
        "verdict-fields",
      );
    }
  }
  if (verdict !== "confirmed") return;
  if (isText(record.severity) && !SEVERITIES.includes(record.severity)) {
    bad(
      ".severity",
      `set it to one of ${SEVERITIES.join(", ")}`,
      "verdict-fields",
    );
  }
  if (isText(record.method) && !["source", "local"].includes(record.method)) {
    bad(
      ".method",
      'set it to "source" when the check was by reading, or "local" when the target was run',
      "verdict-fields",
    );
  }
  const steps = record.steps;
  const hasSteps =
    Array.isArray(steps) && steps.length > 0 && steps.every(isText);
  if (steps !== undefined && !hasSteps) {
    bad(
      ".steps",
      "make it a list of the steps that were run, or remove it",
      "verdict-fields",
    );
  }
  if (record.method === "local" && !hasSteps) {
    bad(
      ".steps",
      "list the steps that reproduced it, since the method is local",
      "ran-code",
    );
  }
}

/**
 * Check a trace: real places, in order from entry to sink.
 * @param {unknown} trace the record's trace
 * @param {(field: string, change: string, rule: keyof typeof RULES) => void} bad reports a failure
 */
function checkTrace(trace, bad) {
  if (!Array.isArray(trace) || trace.length === 0) {
    bad(
      ".trace",
      "list at least one place, as {kind, file, line, note}",
      "trace",
    );
    return;
  }
  trace.forEach((step, index) => {
    const at = `.trace[${index}]`;
    if (!isObject(step)) {
      bad(at, "make it {kind, file, line, note}", "trace");
      return;
    }
    if (!isRepoPath(step.file))
      bad(
        `${at}.file`,
        "write the path relative to the repository, with no .. in it",
        "trace",
      );
    if (!Number.isInteger(step.line) || step.line < 1)
      bad(`${at}.line`, "write the line number, 1 or more", "trace");
    if (!isText(step.note))
      bad(`${at}.note`, "say what happens at this place", "trace");
    const last = trace.length - 1;
    const want =
      index === 0 && last > 0
        ? "entrypoint"
        : index === last && last > 0
          ? "sink"
          : last === 0
            ? null
            : "propagation";
    const ok =
      want === null
        ? ["entrypoint", "sink"].includes(step.kind)
        : step.kind === want;
    if (!ok) {
      bad(
        `${at}.kind`,
        want === null
          ? 'set it to "entrypoint" or "sink"'
          : `set it to "${want}", a trace runs from the entry to the sink`,
        "trace",
      );
    }
  });
}

/**
 * Check that the two files agree, and that the commit is the one asked for.
 * @param {unknown} run the parsed run.json
 * @param {unknown} findings the parsed findings.json
 * @param {{commit?: string}} options the commit the caller expects, when given
 * @returns {ReturnType<typeof failure>[]} every failure found
 */
export function checkTogether(run, findings, options = {}) {
  const out = [];
  if (!isObject(run) || !Array.isArray(findings)) return out;
  const records = new Set(findings.filter(isObject).map((r) => r.fingerprint));
  const candidates = new Set(
    Array.isArray(run.candidates) ? run.candidates : [],
  );
  for (const fp of candidates) {
    if (!records.has(fp) && run.status === "complete") {
      out.push(
        failure(
          `run.json candidates ${safe(fp)}`,
          "add its record to findings.json, or set the run to incomplete",
          "no-dropped-lead",
        ),
      );
    }
  }
  for (const fp of records) {
    if (typeof fp === "string" && !candidates.has(fp)) {
      out.push(
        failure(
          `findings.json ${safe(fp)}`,
          "add this fingerprint to candidates in run.json",
          "no-dropped-lead",
        ),
      );
    }
  }
  const local = findings.some((r) => isObject(r) && r.method === "local");
  if (local && run.ran_target_code === false) {
    out.push(
      failure(
        "run.json ran_target_code",
        "set it to true, a record says the target was run",
        "ran-code",
      ),
    );
  }
  if (options.commit !== undefined && run.commit !== options.commit) {
    out.push(
      failure(
        "run.json commit",
        `review commit ${safe(options.commit)}, this run read ${safe(run.commit)}`,
        "commit",
      ),
    );
  }
  return out;
}

/**
 * Count what a valid run holds, for a report or a gate.
 * @param {Record<string, unknown>} run the parsed run.json
 * @param {Record<string, unknown>[]} findings the parsed findings.json
 * @returns {Record<string, unknown>} counts by verdict, the highest confirmed severity and the run's state
 */
export function summarise(run, findings) {
  const count = (verdict) =>
    findings.filter((r) => r.verdict === verdict).length;
  const ranks = findings
    .filter((r) => r.verdict === "confirmed")
    .map((r) => SEVERITIES.indexOf(/** @type {string} */ (r.severity)));
  return {
    commit: run.commit,
    confirmed: count("confirmed"),
    gaps: /** @type {unknown[]} */ (run.gaps).length,
    highest_confirmed_severity: ranks.length
      ? SEVERITIES[Math.max(...ranks)]
      : null,
    needs_validation: count("needs_validation"),
    ran_target_code: run.ran_target_code,
    rejected: count("rejected"),
    status: run.status,
  };
}

/**
 * Read one JSON file from the run folder without following a link.
 * @param {string} folder the run folder
 * @param {string} name the file's name
 * @returns {{value?: unknown, error?: ReturnType<typeof failure>}} the parsed value, or the failure
 */
function readJson(folder, name) {
  const path = join(folder, name);
  const fail = (change) => ({ error: failure(name, change, "files") });
  let fd;
  try {
    // Open once and check the open file, so the file that is checked is the
    // file that is read. A link is refused at open, and a pipe cannot block.
    fd = openSync(
      path,
      constants.O_RDONLY |
        (constants.O_NOFOLLOW ?? 0) |
        (constants.O_NONBLOCK ?? 0),
    );
  } catch (error) {
    const code = /** @type {{code?: string}} */ (error).code;
    if (code === "ENOENT") return fail("write this file into the run folder");
    return fail("make it a regular file, not a link or a folder");
  }
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile()) {
      return fail("make it a regular file, not a link or a folder");
    }
    if (stat.size > MAX_BYTES) return fail(`keep it under ${MAX_BYTES} bytes`);
    return { value: JSON.parse(readFileSync(fd, "utf8")) };
  } catch {
    return fail("make it valid JSON");
  } finally {
    closeSync(fd);
  }
}

/**
 * Check a run folder.
 * @param {string} folder the run folder
 * @param {{commit?: string}} options the commit the caller expects, when given
 * @returns {{failures: ReturnType<typeof failure>[], summary: null | Record<string, unknown>}} the failures, and a summary when there are none
 */
export function validateFolder(folder, options = {}) {
  const run = readJson(folder, "run.json");
  const findings = readJson(folder, "findings.json");
  const failures = [run.error, findings.error].filter(Boolean);
  if (failures.length > 0) return { failures, summary: null };
  failures.push(
    ...checkRun(run.value),
    ...checkFindings(findings.value),
    ...checkTogether(run.value, findings.value, options),
  );
  return {
    failures,
    summary:
      failures.length === 0 ? summarise(run.value, findings.value) : null,
  };
}

/**
 * Run the command line.
 * @param {string[]} argv the arguments after the script's name
 * @returns {number} the exit status
 */
export function main(argv) {
  const args = [...argv];
  const json = args.includes("--json");
  const at = args.indexOf("--commit");
  const commit = at >= 0 ? args[at + 1] : undefined;
  const folder = args.find(
    (a, i) => !a.startsWith("--") && (at < 0 || i !== at + 1),
  );
  if (!folder || (at >= 0 && !isCommit(commit))) {
    console.error(
      "Usage: node validate.mjs <run-folder> [--commit <full sha>] [--json]",
    );
    return 2;
  }
  const { failures, summary } = validateFolder(folder, { commit });
  if (failures.length > 0) {
    for (const f of failures.slice(0, 100)) {
      console.error(
        `${f.where}: ${f.change}.\n  Rule: ${f.rule}\n  Docs: ${f.docs}`,
      );
    }
    console.error(`FAIL: ${failures.length} problem(s) in ${safe(folder)}`);
    return 1;
  }
  if (json) console.log(JSON.stringify(summary));
  else {
    const s = /** @type {Record<string, unknown>} */ (summary);
    console.log(
      `PASS: ${s.confirmed} confirmed, ${s.needs_validation} needs_validation, ${s.rejected} rejected, ` +
        `${s.gaps} gap(s), highest confirmed severity ${s.highest_confirmed_severity ?? "none"}, run ${s.status}`,
    );
  }
  return 0;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  process.exit(main(process.argv.slice(2)));
}
