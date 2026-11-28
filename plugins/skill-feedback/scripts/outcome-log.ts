#!/usr/bin/env bun
/**
 * outcome-log — the exact work behind the skill outcome log.
 *
 * A skill run ends with one entry in a local JSON Lines file. A review groups
 * the failures by mode and scores each mode from 1 to 10 for severity,
 * occurrence and detection. Their product is the risk priority number (RPN).
 *
 * The local file is the working store, because every run can write it. A
 * private artifact with a database is the shared copy. This script never
 * talks to the artifact. It queues each entry as a JSON file in an outbox,
 * and the skill pushes those files with the `ArtifactData` tool from a
 * session that can reach the artifact.
 *
 * Commands:
 *   append   --skill <name[@version]> | --skill-dir <dir>
 *            --outcome ok|corrected|failed
 *            [--mode <slug>] [--what <text>] [--cause <text>]
 *            [--detected check|review|later-use]
 *            [--fix skill-instructions|skill-script|config|shared-store|check|none]
 *            [--cost <text>] [--date YYYY-MM-DD] [--run <id>]
 *   recent   [--skill <name>] [--date YYYY-MM-DD] [--export <dir>]
 *                                 the latest entries with their ids
 *   pending  [--export <dir>]     entries still to push, as `ArtifactData` batch writes
 *   sent     <id>...              remove pushed entries from the outbox
 *   modes    [--skill <name>] [--export <dir>]
 *   review   [--skill <name>] [--from YYYY-MM-DD] [--to YYYY-MM-DD]
 *            [--export <dir>] [--out <file>] [--json]
 *   severity <skill> <mode> <1-10> [--note <text>]
 *   config                         print the resolved paths and settings
 *
 * `--export <dir>` is a directory written by `ArtifactData` with `out_dir`:
 * one `<doc_id>.json` per document under `runs/` and `reviews/`.
 *
 * Files live in `~/.config/skill-feedback/`, or in `$SKILL_FEEDBACK_HOME`.
 */

import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";

// ------------------------------------------------------------------- types

/** How a run ended. */
export type Outcome = "corrected" | "failed" | "ok";

/** One logged run. Empty strings stand for "nothing to report". */
export interface Entry {
  cause: string;
  cost: string;
  date: string;
  detected: string;
  fix: string;
  id: string;
  loggedAt: string;
  mode: string;
  origin?: string;
  outcome: Outcome;
  /** The id of the earlier entry for the same run, on a failure found later. */
  run?: string;
  skill: string;
  what: string;
}

/** The fields a caller supplies. The script adds `id` and `loggedAt`. */
export type EntryInput = Partial<Omit<Entry, "id" | "loggedAt">>;

/** Local settings in `config.json`. */
export interface Config {
  artifact?: string;
  origin?: string;
}

/** One failure mode of one skill, scored. */
export interface ModeScore {
  count: number;
  detection: number;
  example: string;
  firstDate: string;
  fixes: string[];
  highSeverity: boolean;
  lastDate: string;
  lever: "detection" | "occurrence";
  lowSample: boolean;
  mode: string;
  occurrence: number;
  rate: number;
  rpn: null | number;
  runs: number;
  severity: null | number;
  skill: string;
}

/** The result of a review over a set of entries. */
export interface Review {
  date: string;
  from: string;
  modes: ModeScore[];
  skills: {
    corrected: number;
    failed: number;
    ok: number;
    runs: number;
    skill: string;
  }[];
  to: string;
  unscored: ModeScore[];
}

/** Severity scores per skill and mode, kept between reviews. */
export type Severities = Record<
  string,
  Record<string, { note?: string; severity: number }>
>;

// --------------------------------------------------------------- constants

export const OUTCOMES = ["ok", "corrected", "failed"] as const;
export const DETECTED = ["check", "review", "later-use"] as const;
export const FIXES = [
  "skill-instructions",
  "skill-script",
  "config",
  "shared-store",
  "check",
  "none",
] as const;

/**
 * Detection score per way a failure was found. A check finds it every time,
 * a review depends on someone reading, and later use means the output had
 * already left the run. No logged failure scores 9 or 10, because a failure
 * nobody noticed is not in the log.
 */
export const DETECTION_SCORE: Record<string, number> = {
  check: 2,
  "later-use": 8,
  review: 5,
};

/** Upper bound of the failure rate for each occurrence score from 1 to 9. */
export const OCCURRENCE_BOUNDS = [
  0.005, 0.01, 0.02, 0.05, 0.1, 0.2, 0.33, 0.5, 0.75,
];

/** Below this many runs of a skill, its failure rates are marked as weak. */
export const MIN_SAMPLE = 20;

const SKILL = /^[a-z0-9][a-z0-9_-]*(:[a-z0-9][a-z0-9_-]*)?(@[0-9A-Za-z.+-]+)?$/;
const MODE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const ENTRY_ID = /^\d{8}T\d{6}Z-[a-z0-9][a-z0-9._-]*-[0-9a-z]{4}$/;
const TEXT_LIMIT = 300;

// ------------------------------------------------------------------- paths

/** The directory that holds the log, the outbox and the settings. */
export const home = () =>
  process.env.SKILL_FEEDBACK_HOME ??
  join(homedir(), ".config", "skill-feedback");

const logFile = (root: string) => join(root, "log.jsonl");
const outboxDir = (root: string) => join(root, "outbox");
const severitiesFile = (root: string) => join(root, "severities.json");

function readJson<T>(path: string, fallback: T): T {
  if (!existsSync(path)) return fallback;
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

/** The local settings, or an empty object when there is no `config.json`. */
export const readConfig = (root = home()): Config =>
  readJson<Config>(join(root, "config.json"), {});

// -------------------------------------------------------------- validation

/** The skill's name without its version. */
export const skillName = (skill: string) => skill.split("@")[0];

/** A local calendar date as YYYY-MM-DD. */
export function localDate(now: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`;
}

/**
 * Names a skill from its directory: `<plugin>:<skill>@<version>`, read from
 * the nearest `.claude-plugin/plugin.json` above it. A skill outside a plugin
 * is named by its directory alone.
 */
export function skillFromDir(dir: string): string {
  const skill = basename(resolve(dir));
  let at = resolve(dir);
  while (dirname(at) !== at) {
    const manifest = join(at, ".claude-plugin", "plugin.json");
    if (existsSync(manifest)) {
      const { name, version } = readJson<{ name?: string; version?: string }>(
        manifest,
        {},
      );
      const named = name ? `${name}:${skill}` : skill;
      return version ? `${named}@${version}` : named;
    }
    at = dirname(at);
  }
  return skill;
}

/** Every problem with the input, one sentence each. Empty means valid. */
export function validate(input: EntryInput): string[] {
  const problems: string[] = [];
  const text = (v: unknown) => (typeof v === "string" ? v.trim() : "");
  const skill = text(input.skill);
  const outcome = text(input.outcome);
  const mode = text(input.mode);
  const detected = text(input.detected);
  const fix = text(input.fix);
  const run = text(input.run);

  if (!SKILL.test(skill))
    problems.push(
      `skill must look like name, name@1.2.0 or plugin:name@1.2.0; got "${skill}"`,
    );
  if (!(OUTCOMES as readonly string[]).includes(outcome))
    problems.push(`outcome must be one of ${OUTCOMES.join(", ")}`);
  if (input.date !== undefined && !DATE.test(text(input.date)))
    problems.push("date must be YYYY-MM-DD");
  for (const field of ["what", "cause", "cost"] as const) {
    const value = input[field];
    if (value === undefined) continue;
    if (/[\r\n]/.test(value)) problems.push(`${field} must be one line`);
    if (value.length > TEXT_LIMIT)
      problems.push(`${field} must be at most ${TEXT_LIMIT} characters`);
  }
  if (mode && !MODE.test(mode))
    problems.push(
      `mode must be a short slug such as creates-duplicate; got "${mode}"`,
    );
  if (mode.length > 60) problems.push("mode must be at most 60 characters");
  if (detected && !(DETECTED as readonly string[]).includes(detected))
    problems.push(`detected must be one of ${DETECTED.join(", ")}`);
  if (fix && !(FIXES as readonly string[]).includes(fix))
    problems.push(`fix must be one of ${FIXES.join(", ")}`);
  if (run && !ENTRY_ID.test(run))
    problems.push(
      `run must be the id of an earlier entry, such as 20261128T101502Z-expenses-1a2b; got "${run}"`,
    );

  if (outcome === "ok") {
    if (mode || text(input.what) || detected || run)
      problems.push("an ok run has no mode, what, detected or run");
  } else if (outcome === "corrected" || outcome === "failed") {
    if (!mode) problems.push(`a ${outcome} run needs a mode`);
    if (!text(input.what)) problems.push(`a ${outcome} run needs what`);
    if (!detected) problems.push(`a ${outcome} run needs detected`);
  }
  return problems;
}

/** Builds the stored entry from valid input. Throws when the input is not valid. */
export function buildEntry(
  input: EntryInput,
  now = new Date(),
  suffix = Math.random().toString(16).slice(2, 6).padEnd(4, "0"),
): Entry {
  const problems = validate(input);
  if (problems.length) throw new Error(problems.join("\n"));
  const skill = input.skill!.trim();
  const stamp = now
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d+Z$/, "Z");
  const slug = skillName(skill).replace(":", ".");
  const entry: Entry = {
    cause: (input.cause ?? "").trim(),
    cost: (input.cost ?? "").trim(),
    date: (input.date ?? localDate(now)).trim(),
    detected: (input.detected ?? "").trim(),
    fix: (input.fix ?? "").trim(),
    id: `${stamp}-${slug}-${suffix}`,
    loggedAt: now.toISOString(),
    mode: (input.mode ?? "").trim(),
    outcome: input.outcome!.trim() as Outcome,
    skill,
    what: (input.what ?? "").trim(),
  };
  if (input.origin?.trim()) entry.origin = input.origin.trim();
  if (input.run?.trim()) entry.run = input.run.trim();
  return entry;
}

// ------------------------------------------------------------------- store

/**
 * Appends one entry to the local log. With an artifact configured, the entry
 * is also queued in the outbox as the document to push.
 *
 * The outbox document is written first. A failure there leaves the log
 * untouched, and a failed log write removes the queued document again, so a
 * retry after either failure records the run once.
 */
export function appendEntry(
  input: EntryInput,
  root = home(),
  now = new Date(),
  suffix?: string,
): { entry: Entry; outboxFile: null | string } {
  const config = readConfig(root);
  const entry = buildEntry({ origin: config.origin, ...input }, now, suffix);
  mkdirSync(root, { recursive: true });
  let outboxFile: null | string = null;
  if (config.artifact) {
    mkdirSync(outboxDir(root), { recursive: true });
    outboxFile = join(outboxDir(root), `${entry.id}.json`);
    writeFileSync(outboxFile, JSON.stringify(document(entry), null, 2) + "\n");
  }
  try {
    appendFileSync(logFile(root), JSON.stringify(entry) + "\n");
  } catch (e) {
    if (outboxFile) rmSync(outboxFile, { force: true });
    throw e;
  }
  return { entry, outboxFile };
}

/** The entry as stored in the artifact: the id is the document's name, not a field. */
function document(entry: Entry): Omit<Entry, "id"> {
  const copy: Partial<Entry> = { ...entry };
  delete copy.id;
  return copy as Omit<Entry, "id">;
}

const STORED_TEXT = [
  "cause",
  "cost",
  "date",
  "detected",
  "fix",
  "loggedAt",
  "mode",
  "outcome",
  "skill",
  "what",
] as const;

/**
 * True when a stored record has every field of an entry and passes the same
 * rules as new input. An export document has no `id` field, because its file
 * name is the id.
 */
function isStored(record: unknown, needId: boolean): record is Entry {
  if (!record || typeof record !== "object" || Array.isArray(record))
    return false;
  const r = record as Record<string, unknown>;
  if (STORED_TEXT.some((field) => typeof r[field] !== "string")) return false;
  if (needId && (typeof r.id !== "string" || !r.id)) return false;
  for (const field of ["origin", "run"])
    if (r[field] !== undefined && typeof r[field] !== "string") return false;
  if (!DATE.test(r.date as string)) return false;
  return validate(r as EntryInput).length === 0;
}

/** The local log. `skipped` counts lines that are not valid entries. */
export function readLog(root = home()): { entries: Entry[]; skipped: number } {
  if (!existsSync(logFile(root))) return { entries: [], skipped: 0 };
  const entries: Entry[] = [];
  let skipped = 0;
  for (const line of readFileSync(logFile(root), "utf8").split("\n")) {
    if (!line.trim()) continue;
    let record: unknown = null;
    try {
      record = JSON.parse(line);
    } catch {
      // Counted below with the other lines that are not entries.
    }
    if (isStored(record, true)) entries.push(record);
    else skipped++;
  }
  return { entries, skipped };
}

function jsonFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .sort();
}

const docId = (file: string) => file.slice(0, -".json".length);

/**
 * The entries in an `ArtifactData` export directory. The file name is the id.
 * `invalid` lists the ids of documents that are not valid entries.
 */
export function readExport(dir: string): {
  entries: Entry[];
  invalid: string[];
} {
  const runs = join(dir, "runs");
  const entries: Entry[] = [];
  const invalid: string[] = [];
  for (const f of jsonFiles(runs)) {
    let record: unknown = null;
    try {
      record = JSON.parse(readFileSync(join(runs, f), "utf8"));
    } catch {
      // Listed below with the other documents that are not entries.
    }
    if (isStored(record, false)) entries.push({ ...record, id: docId(f) });
    else invalid.push(docId(f));
  }
  return { entries, invalid };
}

/** Entries from several sources, one per id, oldest first. */
export function merge(...sources: Entry[][]): Entry[] {
  const byId = new Map<string, Entry>();
  for (const source of sources) for (const e of source) byId.set(e.id, e);
  return [...byId.values()].sort((a, b) => a.id.localeCompare(b.id));
}

/**
 * The entries still to push, as `ArtifactData` batch writes. An entry whose
 * id is already in the export is dropped from the outbox instead. Every
 * exported document counts here, valid or not, because a second write to its
 * id would be refused.
 */
export function pending(
  root = home(),
  exportDir?: string,
): {
  alreadyThere: string[];
  writes: {
    collection: string;
    doc_id: string;
    file_path: string;
    op: string;
  }[];
} {
  const there = new Set(
    exportDir ? jsonFiles(join(exportDir, "runs")).map(docId) : [],
  );
  const alreadyThere: string[] = [];
  const writes = [];
  for (const f of jsonFiles(outboxDir(root))) {
    const id = docId(f);
    if (there.has(id)) {
      rmSync(join(outboxDir(root), f));
      alreadyThere.push(id);
    } else
      writes.push({
        collection: "runs",
        doc_id: id,
        file_path: join(outboxDir(root), f),
        op: "set",
      });
  }
  return { alreadyThere, writes };
}

/** Removes pushed entries from the outbox. Returns the ids that were queued. */
export function markSent(ids: string[], root = home()): string[] {
  const done: string[] = [];
  for (const id of ids) {
    const file = join(outboxDir(root), `${basename(id)}.json`);
    if (!existsSync(file)) continue;
    rmSync(file);
    done.push(id);
  }
  return done;
}

// ------------------------------------------------------------------ scoring

/** Occurrence from 1 to 10 for a failure rate between 0 and 1. */
export function occurrenceScore(rate: number): number {
  const i = OCCURRENCE_BOUNDS.findIndex((bound) => rate <= bound);
  return i === -1 ? 10 : i + 1;
}

/** Detection from 1 to 10: the mean score of how each failure was found. */
export function detectionScore(detected: string[]): number {
  const scores = detected.map(
    (d) => DETECTION_SCORE[d] ?? DETECTION_SCORE.review,
  );
  if (!scores.length) return DETECTION_SCORE.review;
  return Math.round(scores.reduce((a, b) => a + b, 0) / scores.length);
}

/** Severities kept locally, or an empty object. */
export const readSeverities = (root = home()): Severities =>
  readJson<Severities>(severitiesFile(root), {});

/** Stores one severity score. Throws when the score is not a whole number from 1 to 10. */
export function setSeverity(
  skill: string,
  mode: string,
  severity: number,
  note?: string,
  root = home(),
): Severities {
  if (!Number.isInteger(severity) || severity < 1 || severity > 10)
    throw new Error("severity must be a whole number from 1 to 10");
  if (!MODE.test(mode)) throw new Error(`mode must be a slug; got "${mode}"`);
  const all = readSeverities(root);
  const name = skillName(skill);
  all[name] = {
    ...all[name],
    [mode]: note ? { note, severity } : { severity },
  };
  mkdirSync(root, { recursive: true });
  writeFileSync(severitiesFile(root), JSON.stringify(all, null, 2) + "\n");
  return all;
}

/**
 * Severities from the reviews stored in an export, for modes scored on
 * another machine. A later review replaces an earlier score for the same
 * mode and keeps the scores of modes it does not cover. Local scores win
 * where both exist.
 */
export function severitiesFromExport(dir: string): Severities {
  const folder = join(dir, "reviews");
  const reviews: Review[] = [];
  for (const f of jsonFiles(folder)) {
    try {
      reviews.push(JSON.parse(readFileSync(join(folder, f), "utf8")) as Review);
    } catch {
      // A review document that is not JSON carries no scores.
    }
  }
  reviews.sort((a, b) => String(a?.date).localeCompare(String(b?.date)));
  const out: Severities = {};
  for (const r of reviews)
    for (const m of [...(r?.modes ?? []), ...(r?.unscored ?? [])]) {
      if (typeof m.severity !== "number") continue;
      out[m.skill] = { ...out[m.skill], [m.mode]: { severity: m.severity } };
    }
  return out;
}

/** The latest entries with their ids, newest first, to find a run to refer to. */
export function recentEntries(
  entries: Entry[],
  options: { date?: string; limit?: number; skill?: string } = {},
): Pick<Entry, "date" | "id" | "mode" | "outcome" | "skill">[] {
  const wanted = options.skill ? skillName(options.skill) : undefined;
  return entries
    .filter(
      (e) =>
        (!wanted || skillName(e.skill) === wanted) &&
        (!options.date || e.date === options.date),
    )
    .sort((a, b) => b.id.localeCompare(a.id))
    .slice(0, options.limit ?? 20)
    .map(({ date, id, mode, outcome, skill }) => ({
      date,
      id,
      mode,
      outcome,
      skill,
    }));
}

/** The known mode slugs per skill with their counts, most frequent first. */
export function knownModes(
  entries: Entry[],
  skill?: string,
): { count: number; mode: string; skill: string }[] {
  const counts = new Map<string, number>();
  for (const e of entries) {
    if (!e.mode) continue;
    const name = skillName(e.skill);
    if (skill && name !== skillName(skill)) continue;
    const key = `${name}\n${e.mode}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([key, count]) => {
      const [name, mode] = key.split("\n");
      return { count, mode, skill: name };
    })
    .sort(
      (a, b) =>
        b.count - a.count ||
        a.skill.localeCompare(b.skill) ||
        a.mode.localeCompare(b.mode),
    );
}

/**
 * Groups the failures by skill and mode, scores each group and ranks them.
 * Modes without a severity cannot be ranked and come back as `unscored`.
 *
 * A run is counted once. An entry that names an earlier entry in `run` is
 * part of that entry's run, so a failure found days after an `ok` entry makes
 * one failed run out of the two entries. The run's date is its earliest
 * entry's date.
 */
export function review(
  entries: Entry[],
  severities: Severities = {},
  options: { from?: string; now?: Date; skill?: string; to?: string } = {},
): Review {
  const wanted = options.skill ? skillName(options.skill) : undefined;
  const byRun = new Map<
    string,
    { date: string; entries: Entry[]; skill: string }
  >();
  for (const e of [...entries].sort((a, b) => a.id.localeCompare(b.id))) {
    const name = skillName(e.skill);
    if (wanted && name !== wanted) continue;
    const key = `${name}\n${e.run || e.id}`;
    const run = byRun.get(key) ?? { date: e.date, entries: [], skill: name };
    if (e.date < run.date) run.date = e.date;
    run.entries.push(e);
    byRun.set(key, run);
  }
  const inWindow = [...byRun.values()].filter(
    (run) =>
      (!options.from || run.date >= options.from) &&
      (!options.to || run.date <= options.to),
  );

  const skills = new Map<string, Review["skills"][number]>();
  const groups = new Map<string, Entry[]>();
  for (const run of inWindow) {
    const s = skills.get(run.skill) ?? {
      corrected: 0,
      failed: 0,
      ok: 0,
      runs: 0,
      skill: run.skill,
    };
    const failures = run.entries.filter((e) => e.outcome !== "ok");
    const outcome = failures.length
      ? failures[failures.length - 1].outcome
      : "ok";
    s.runs++;
    if (outcome in s) s[outcome]++;
    skills.set(run.skill, s);
    // One run counts once per mode, by its latest entry for that mode.
    const perMode = new Map<string, Entry>();
    for (const e of failures) if (e.mode) perMode.set(e.mode, e);
    for (const [mode, e] of perMode) {
      const key = `${run.skill}\n${mode}`;
      groups.set(key, [...(groups.get(key) ?? []), e]);
    }
  }

  const scored: ModeScore[] = [];
  for (const [key, group] of groups) {
    const [name, mode] = key.split("\n");
    const runs = skills.get(name)!.runs;
    const rate = group.length / runs;
    const occurrence = occurrenceScore(rate);
    const detection = detectionScore(group.map((e) => e.detected));
    const severity = severities[name]?.[mode]?.severity ?? null;
    const dates = group.map((e) => e.date).sort();
    scored.push({
      count: group.length,
      detection,
      example: group[group.length - 1].what,
      firstDate: dates[0],
      fixes: [...new Set(group.map((e) => e.fix).filter(Boolean))].sort(),
      highSeverity: severity !== null && severity >= 9,
      lastDate: dates[dates.length - 1],
      lever: detection >= occurrence ? "detection" : "occurrence",
      lowSample: runs < MIN_SAMPLE,
      mode,
      occurrence,
      rate,
      rpn: severity === null ? null : severity * occurrence * detection,
      runs,
      severity,
      skill: name,
    });
  }

  const byName = (a: ModeScore, b: ModeScore) =>
    a.skill.localeCompare(b.skill) || a.mode.localeCompare(b.mode);
  const dates = inWindow.map((run) => run.date).sort();
  return {
    date: localDate(options.now ?? new Date()),
    from: options.from ?? dates[0] ?? "",
    modes: scored
      .filter((m) => m.rpn !== null)
      .sort(
        (a, b) =>
          b.rpn! - a.rpn! ||
          b.severity! - a.severity! ||
          b.count - a.count ||
          byName(a, b),
      ),
    skills: [...skills.values()].sort(
      (a, b) => b.runs - a.runs || a.skill.localeCompare(b.skill),
    ),
    to: options.to ?? dates[dates.length - 1] ?? "",
    unscored: scored
      .filter((m) => m.rpn === null)
      .sort((a, b) => b.count - a.count || byName(a, b)),
  };
}

/** The review as markdown tables, for the operator to read. */
export function renderReview(r: Review): string {
  const lines: string[] = [];
  const total = r.skills.reduce((n, s) => n + s.runs, 0);
  lines.push(
    `Review of ${r.date}: ${total} ${total === 1 ? "run" : "runs"} from ${r.from || "?"} to ${r.to || "?"}.`,
    "",
  );
  if (!total) return lines.join("\n") + "No entries in this window.\n";

  lines.push(
    "| Skill | Runs | Ok | Corrected | Failed |",
    "| --- | ---: | ---: | ---: | ---: |",
  );
  for (const s of r.skills)
    lines.push(
      `| ${s.skill} | ${s.runs} | ${s.ok} | ${s.corrected} | ${s.failed} |`,
    );
  lines.push("");

  const row = (m: ModeScore) => {
    const flags = [
      m.highSeverity ? "severity 9 or 10" : "",
      m.lowSample ? `fewer than ${MIN_SAMPLE} runs` : "",
    ].filter(Boolean);
    return `| ${m.skill} | ${m.mode} | ${m.count}/${m.runs} | ${m.severity ?? "?"} | ${m.occurrence} | ${m.detection} | ${m.rpn ?? "?"} | ${m.lever} | ${flags.join(", ")} |`;
  };
  const head = [
    "| Skill | Failure mode | Count | S | O | D | RPN | Lever | Flags |",
    "| --- | --- | ---: | ---: | ---: | ---: | ---: | --- | --- |",
  ];
  if (r.modes.length)
    lines.push(
      "Ranked by risk priority number:",
      "",
      ...head,
      ...r.modes.map(row),
      "",
    );
  if (r.unscored.length)
    lines.push(
      "Not ranked, because these modes have no severity yet:",
      "",
      ...head,
      ...r.unscored.map(row),
      "",
    );
  if (!r.modes.length && !r.unscored.length)
    lines.push("No failures were logged in this window.", "");
  return lines.join("\n");
}

// --------------------------------------------------------------------- cli

const fail = (message: string): never => {
  console.error(message);
  process.exit(1);
};

function parseFlags(argv: string[]): {
  flags: Record<string, string>;
  rest: string[];
} {
  const flags: Record<string, string> = {};
  const rest: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith("--")) rest.push(arg);
    else if (arg === "--json") flags.json = "1";
    else if (i + 1 >= argv.length) fail(`${arg} needs a value`);
    else flags[arg.slice(2)] = argv[++i];
  }
  return { flags, rest };
}

function main(argv: string[]): void {
  const [command, ...args] = argv;
  const { flags, rest } = parseFlags(args);
  const root = home();
  const print = (value: unknown) => console.log(JSON.stringify(value, null, 2));
  const all = () =>
    merge(
      flags.export ? readExport(flags.export).entries : [],
      readLog(root).entries,
    );

  switch (command) {
    case "append": {
      const skill =
        flags.skill ??
        (flags["skill-dir"] ? skillFromDir(flags["skill-dir"]) : undefined);
      try {
        const { entry, outboxFile } = appendEntry(
          {
            cause: flags.cause,
            cost: flags.cost,
            date: flags.date,
            detected: flags.detected,
            fix: flags.fix,
            mode: flags.mode,
            outcome: flags.outcome as Outcome,
            run: flags.run,
            skill,
            what: flags.what,
          },
          root,
        );
        print({
          artifact: readConfig(root).artifact ?? null,
          entry,
          logFile: logFile(root),
          outboxFile,
        });
      } catch (e) {
        fail((e as Error).message);
      }
      break;
    }
    case "pending":
      print({
        artifact: readConfig(root).artifact ?? null,
        ...pending(root, flags.export),
      });
      break;
    case "sent":
      print({ removed: markSent(rest, root) });
      break;
    case "modes":
      print(knownModes(all(), flags.skill));
      break;
    case "recent":
      print(recentEntries(all(), { date: flags.date, skill: flags.skill }));
      break;
    case "review": {
      const severities = {
        ...(flags.export ? severitiesFromExport(flags.export) : {}),
      };
      for (const [skill, modes] of Object.entries(readSeverities(root)))
        severities[skill] = { ...severities[skill], ...modes };
      const result = review(all(), severities, {
        from: flags.from,
        skill: flags.skill,
        to: flags.to,
      });
      if (flags.out) {
        mkdirSync(dirname(resolve(flags.out)), { recursive: true });
        writeFileSync(flags.out, JSON.stringify(result, null, 2) + "\n");
      }
      if (flags.json) print(result);
      else {
        console.log(renderReview(result));
        const { skipped } = readLog(root);
        if (skipped)
          console.log(
            `Left out of ${logFile(root)}, because they are not valid entries: ${skipped} ${skipped === 1 ? "line" : "lines"}.`,
          );
        const invalid = flags.export ? readExport(flags.export).invalid : [];
        if (invalid.length)
          console.log(
            `Left out of the export, because they are not valid entries: ${invalid.join(", ")}.`,
          );
      }
      break;
    }
    case "severity": {
      const [skill, mode, score] = rest;
      if (!skill || !mode || !score)
        fail("usage: severity <skill> <mode> <1-10> [--note <text>]");
      try {
        setSeverity(skill, mode, Number(score), flags.note, root);
        print({ mode, severity: Number(score), skill: skillName(skill) });
      } catch (e) {
        fail((e as Error).message);
      }
      break;
    }
    case "config":
      print({
        ...readConfig(root),
        entries: readLog(root).entries.length,
        home: root,
        logFile: logFile(root),
        outbox: jsonFiles(outboxDir(root)).length,
      });
      break;
    default:
      fail(
        "usage: outcome-log.ts append|recent|pending|sent|modes|review|severity|config (see the file header)",
      );
  }
}

if (import.meta.main) main(process.argv.slice(2));
