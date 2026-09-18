#!/usr/bin/env bun
/**
 * archive-done — move completed dashboard items into the monthly work log.
 *
 * Runs across every client, not just the resolved one. Three levels of tidying,
 * each following from the last:
 *
 *   1. A ticked `- [x]` item moves to the archive.
 *   2. A client group left with no checkbox items moves entirely — heading,
 *      intention callout and prose — because an empty group is noise.
 *   3. A day left with no client groups loses its heading too.
 *
 * It then runs `roll-forward.ts --shift-only`, so a finished day is replaced by
 * the next one rather than leaving the dashboard with no day in focus.
 *
 * Dashboard shape:  `### <Day>` → `#### **<Client>**` → items
 * Archive shape:    `#### <Day>` → `**<Client>**` → items, newest day first
 *
 * The archive is `Archive/Work Logs/<year>/<Month>.md`, created if absent.
 * Idempotent: a second run with nothing ticked writes nothing.
 *
 * Usage:
 *   bun archive-done.ts               # apply, print "Done" or "No items…"
 *   bun archive-done.ts --dry-run     # report what would move, change nothing
 *   bun archive-done.ts --verbose     # per-day, per-client detail
 */

import {
  copyFileSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

interface Config {
  vault: string;
  dashboard: string;
  default_client?: string;
}

/** One client's block within a day: its heading, prose and item lines. */
interface Group {
  client: string;
  headingIndex: number;
  endIndex: number;
  lines: string[];
}

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const verbose = args.includes("--verbose");

function fail(message: string): never {
  process.stderr.write(`archive-done: ${message}\n`);
  process.exit(1);
}

const configPath = join(homedir(), ".claude", "obsidian.json");
let config: Config;
try {
  config = JSON.parse(readFileSync(configPath, "utf8"));
} catch (e) {
  fail(`cannot read ${configPath}: ${(e as Error).message}`);
}

// DASHBOARD_PATH points the run at a fixture instead of the vault, so the
// archive lands beside it. The tests need it; nothing else sets it.
const dashboardPath =
  process.env.DASHBOARD_PATH ?? join(config.vault, config.dashboard);
const vault = process.env.DASHBOARD_PATH
  ? dirname(dashboardPath)
  : config.vault;

// An iCloud conflict copy means two versions disagree; never edit blind.
const conflicts = (() => {
  try {
    // Grouped, because ^ bound only to the first branch: this read as
    // "starts with Dashboard<digit>" OR "contains conflicted anywhere".
    // That is what was wanted, but nothing in the pattern said so.
    return readdirSync(vault).filter((f) =>
      /(?:^Dashboard \d)|(?:conflicted)/i.test(f),
    );
  } catch {
    return [];
  }
})();
if (conflicts.length)
  fail(`iCloud conflict copies present: ${conflicts.join(", ")}`);

// Read once and keep the exact bytes. Existence is not checked first: between
// the check and the read the file can go, and the read reports that anyway.
let before: string;
try {
  before = readFileSync(dashboardPath, "utf8");
} catch (e) {
  const err = e as NodeJS.ErrnoException;
  fail(
    err.code === "ENOENT"
      ? `no dashboard at ${dashboardPath}`
      : `cannot read ${dashboardPath}: ${err.message}`,
  );
}
const lines = before.split("\n");

// A day inside the Tomorrow/Future callouts is `> ### …` and a group is
// `> #### …`. The *processing* rules below still only touch the unprefixed
// day, but boundary detection has to see the quoted ones — otherwise the
// scan for "the next day heading" never matches, `end` keeps its focusEnd
// default, and today's last group swallows both bands on the way to the
// archive. That is issue #53, and it cost the whole Focus section once.
const stripQuotes = (l: string) => l.replace(/^(?:> ?)+/, "");
const isAnyDayHeading = (l: string) =>
  /^#{2,3} [A-Z][a-z]+day \d{1,2} [A-Z][a-z]+/.test(stripQuotes(l));
const isAnyClientHeading = (l: string) => /^#### /.test(stripQuotes(l));
// `> [!note]- Tomorrow` opens a band; `> [!note] Intention:` does not. The
// trailing `-` is the only thing separating them, so match on it exactly.
const isBandStart = (l: string) => /^> \[!note\]- /.test(l);
// A boundary is any later day, any later group, or the start of a band.
const endsDay = (l: string) => isAnyDayHeading(l) || isBandStart(l);
const endsGroup = (l: string) => isAnyClientHeading(l) || endsDay(l);

const isDayHeading = (l: string) => !l.startsWith(">") && isAnyDayHeading(l);
const isClientHeading = (l: string) =>
  !l.startsWith(">") && isAnyClientHeading(l);
const isItem = (l: string) => /^- \[[ x]\]/.test(l);
const isTicked = (l: string) => /^- \[x\]/.test(l);
const clientName = (l: string) =>
  l
    .replace(/^####\s*/, "")
    .replace(/\*\*/g, "")
    .trim();

// --- locate the Focus section -------------------------------------------
const focusIndex = lines.findIndex((l) => /^## Focus\s*$/.test(l));
if (focusIndex === -1) fail("no '## Focus' section in the dashboard");
const focusEnd = (() => {
  for (let i = focusIndex + 1; i < lines.length; i++) {
    if (/^## /.test(lines[i])) return i;
  }
  return lines.length;
})();

// --- collect the days, and the client groups inside each ----------------
interface Day {
  title: string;
  headingIndex: number;
  endIndex: number;
  groups: Group[];
}

const days: Day[] = [];
for (let i = focusIndex + 1; i < focusEnd; i++) {
  if (!isDayHeading(lines[i])) continue;
  const title = lines[i].replace(/^#{2,3}\s*/, "").trim();
  let end = focusEnd;
  for (let j = i + 1; j < focusEnd; j++) {
    if (endsDay(lines[j])) {
      end = j;
      break;
    }
  }
  const groups: Group[] = [];
  for (let j = i + 1; j < end; j++) {
    if (!isClientHeading(lines[j])) continue;
    let gEnd = end;
    for (let k = j + 1; k < end; k++) {
      if (endsGroup(lines[k])) {
        gEnd = k;
        break;
      }
    }
    groups.push({
      client: clientName(lines[j]),
      headingIndex: j,
      endIndex: gEnd,
      lines: lines.slice(j, gEnd),
    });
  }
  days.push({ title, headingIndex: i, endIndex: end, groups });
}

// --- decide what moves ---------------------------------------------------
interface Move {
  day: string;
  client: string;
  /** Lines to write into the archive, in order. */
  archived: string[];
  /** Whole group leaves the dashboard. */
  wholeGroup: boolean;
}

const moves: Move[] = [];
/** Dashboard line indices to delete, collected and applied bottom-up. */
const deletions: Array<[number, number]> = [];
const emptiedDays: string[] = [];

for (const day of days) {
  let groupsRemaining = day.groups.length;

  for (const group of day.groups) {
    const items = group.lines.filter(isItem);
    const ticked = group.lines.filter(isTicked);
    if (ticked.length === 0) continue;

    const openLeft = items.length - ticked.length;

    if (openLeft === 0) {
      // Nothing open left: the whole group goes, prose and all.
      const body = group.lines.slice(1); // drop the #### heading
      moves.push({
        day: day.title,
        client: group.client,
        archived: body,
        wholeGroup: true,
      });
      deletions.push([group.headingIndex, group.endIndex]);
      groupsRemaining--;
    } else {
      // Partial: only the ticked lines move.
      moves.push({
        day: day.title,
        client: group.client,
        archived: ticked,
        wholeGroup: false,
      });
      for (let i = group.headingIndex; i < group.endIndex; i++) {
        if (isTicked(lines[i])) deletions.push([i, i + 1]);
      }
    }
  }

  if (day.groups.length > 0 && groupsRemaining === 0) {
    // Every client group left: the day heading has nothing to head. Drop the
    // per-group ranges already queued inside this day first — overlapping
    // ranges delete twice once earlier splices have shifted the array.
    for (let i = deletions.length - 1; i >= 0; i--) {
      if (
        deletions[i][0] >= day.headingIndex &&
        deletions[i][1] <= day.endIndex
      ) {
        deletions.splice(i, 1);
      }
    }
    deletions.push([day.headingIndex, day.endIndex]);
    emptiedDays.push(day.title);
  }
}

if (moves.length === 0) {
  process.stdout.write("No items found to archive\n");
  process.exit(0);
}

// --- write the archive ---------------------------------------------------
/** Collapse runs of two or more blank lines left behind by splicing. */
function collapseBlanks(block: string[]): string[] {
  const out: string[] = [];
  for (const line of block) {
    if (line.trim() === "" && out.length && out[out.length - 1].trim() === "")
      continue;
    out.push(line);
  }
  return out;
}

/** Drop leading and trailing blank lines, keep the internal shape. */
function trimEdges(block: string[]): string[] {
  let start = 0;
  let end = block.length;
  while (start < end && block[start].trim() === "") start++;
  while (end > start && block[end - 1].trim() === "") end--;
  return block.slice(start, end);
}

/** "Wednesday 12 August" → {day: 12, month: "August"} */
function parseDay(title: string): { day: number; month: string } | null {
  const m = title.match(/^[A-Z][a-z]+day (\d{1,2}) ([A-Z][a-z]+)/);
  if (!m) return null;
  return { day: Number(m[1]), month: m[2] };
}

const year = new Date().getFullYear();
const byMonth = new Map<string, Move[]>();
for (const move of moves) {
  const parsed = parseDay(move.day);
  if (!parsed) fail(`cannot parse day heading "${move.day}"`);
  const key = parsed.month;
  byMonth.set(key, [...(byMonth.get(key) ?? []), move]);
}

// One snapshot for the whole run, taken before the first write of either
// file. `snapshotDashboard` is a hoisted function declaration, defined with
// its rationale further down next to the write itself.
const snapshot = dryRun ? null : snapshotDashboard();

const written: string[] = [];

for (const [month, monthMoves] of byMonth) {
  const path = join(vault, "Archive", "Work Logs", String(year), `${month}.md`);
  let archive: string[];
  // What the file held when this run read it, or null when it was not there.
  // Checking existence and then acting on the answer is the race: another
  // session can create the log in between, and the template below would then
  // overwrite everything it had just written.
  let logBefore: string | null;

  try {
    logBefore = readFileSync(path, "utf8");
    archive = logBefore.split("\n");
  } catch (e) {
    const err = e as NodeJS.ErrnoException;
    if (err.code !== "ENOENT") fail(`cannot read ${path}: ${err.message}`);
    logBefore = null;
    // The work log spans every client, so it belongs to the vault owner —
    // `default_client`, read from config rather than hardcoded.
    archive = [
      "---",
      "type: reference",
      `client: ${config.default_client ?? "Unknown"}`,
      "status: active",
      "tags: [work-log, archive]",
      `created: ${new Date().toISOString().slice(0, 10)}`,
      "---",
      "",
      `# Work Log: ${month} ${year}`,
      "",
    ];
  }

  // Group the moves by day so each day is handled once.
  const dayOrder = [...new Set(monthMoves.map((m) => m.day))];

  for (const dayTitle of dayOrder) {
    const dayMoves = monthMoves.filter((m) => m.day === dayTitle);
    let dayIdx = archive.findIndex((l) => l.trim() === `#### ${dayTitle}`);

    if (dayIdx === -1) {
      // New day entry, inserted newest-first among the existing #### days.
      const target = parseDay(dayTitle)!.day;
      let insertAt = archive.length;
      for (let i = 0; i < archive.length; i++) {
        const m = archive[i].match(
          /^#### ([A-Z][a-z]+day (\d{1,2}) [A-Z][a-z]+)/,
        );
        if (m && Number(m[2]) < target) {
          insertAt = i;
          break;
        }
      }
      const block = [`#### ${dayTitle}`, ""];
      archive.splice(insertAt, 0, ...block);
      dayIdx = insertAt;
    }

    // End of this day's block in the archive.
    let dayEnd = archive.length;
    for (let i = dayIdx + 1; i < archive.length; i++) {
      if (/^#### /.test(archive[i])) {
        dayEnd = i;
        break;
      }
    }

    for (const move of dayMoves) {
      const marker = `**${move.client}**`;
      let clientIdx = -1;
      for (let i = dayIdx + 1; i < dayEnd; i++) {
        if (archive[i].trim() === marker) {
          clientIdx = i;
          break;
        }
      }

      if (clientIdx === -1) {
        // New client block at the end of the day's entry.
        let at = dayEnd;
        while (at > dayIdx + 1 && archive[at - 1].trim() === "") at--;
        const block = ["", marker, "", ...trimEdges(move.archived), ""];
        archive.splice(at, 0, ...block);
        dayEnd += block.length;
      } else {
        // Append to the existing client block, after its last non-blank line.
        // The block ends at the next client marker — a line that is bold and
        // nothing else. A topical paragraph carries trailing text, so it does
        // not match and its items stay inside this client.
        let end = dayEnd;
        for (let i = clientIdx + 1; i < dayEnd; i++) {
          if (/^\*\*[^*]+\*\*$/.test(archive[i].trim())) {
            end = i;
            break;
          }
        }
        let at = end;
        while (at > clientIdx + 1 && archive[at - 1].trim() === "") at--;
        // A callout or paragraph needs a blank line before it or markdown
        // treats it as a lazy continuation of the list item above.
        const body = trimEdges(move.archived);
        const needsGap = !/^- \[[ x]\]/.test(body[0] ?? "");
        const block = needsGap ? ["", ...body] : body;
        archive.splice(at, 0, ...block);
        dayEnd += block.length;
      }
    }
  }

  if (!dryRun) {
    // Same compare-and-swap as the dashboard: a log that moved since it was
    // read belongs to someone else's run, and this write would erase it.
    let logNow: string | null;
    try {
      logNow = readFileSync(path, "utf8");
    } catch (e) {
      const err = e as NodeJS.ErrnoException;
      if (err.code !== "ENOENT") fail(`cannot re-read ${path}: ${err.message}`);
      logNow = null;
    }
    if (logNow !== logBefore) {
      fail(
        `${path} changed while this run was working. Nothing written; run it again.`,
      );
    }
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, collapseBlanks(archive).join("\n"), "utf8");
  }
  written.push(path);
}

// --- write protocol: snapshot before touching anything -------------------
// The vault is not version-controlled and several agents write one dashboard,
// so without a snapshot there is no way to tell afterwards whether a
// difference was this run, another session, or a lost edit. That matters more
// here than anywhere else: this is the operation whose job is to *remove*
// content, and a wrong archive looks exactly like a correct one afterwards.
// Implemented inline rather than shelling out to obsidian's dashboard-guard.sh
// — installed plugins live under their own versioned directories, so a path to
// a sibling plugin would pin an obsidian version and rot on its next release.
function snapshotDashboard(): string {
  const snapDir =
    process.env.DASHBOARD_SNAPSHOT_DIR ??
    join(homedir(), ".claude", "dashboard-snapshots");
  const keepDays = Number(process.env.DASHBOARD_SNAPSHOT_DAYS ?? "14");
  const base = dashboardPath.split("/").pop()!.replace(/\.md$/, "");
  mkdirSync(snapDir, { recursive: true });
  const d = new Date();
  const p2 = (n: number) => String(n).padStart(2, "0");
  const stamp =
    `${d.getFullYear()}${p2(d.getMonth() + 1)}${p2(d.getDate())}` +
    `-${p2(d.getHours())}${p2(d.getMinutes())}${p2(d.getSeconds())}`;
  const snap = join(snapDir, `${base}-${stamp}.md`);
  copyFileSync(dashboardPath, snap);
  // Keep the directory bounded; a snapshot is only useful while the edit that
  // produced it is still in question.
  const cutoff = Date.now() - keepDays * 86400000;
  for (const f of readdirSync(snapDir)) {
    if (!f.startsWith(`${base}-`) || !f.endsWith(".md")) continue;
    const full = join(snapDir, f);
    try {
      if (statSync(full).mtimeMs < cutoff) unlinkSync(full);
    } catch {
      // A snapshot that cannot be pruned is not worth failing a run over.
    }
  }
  return snap;
}

// A day cleared of its work but still carrying its heading reads as a broken
// dashboard, so the archive turns the page itself rather than leaving it to a
// second command. `--shift-only` never moves another client's still-open work,
// and the shift's own guard decides whether today is actually finished.
function turnThePage(): string {
  const script = join(import.meta.dir, "roll-forward.ts");
  // process.execPath, not "bun": the interpreter already running this file is
  // the one that can run the next one. A bare name resolves against PATH, and
  // the caller that most needs this is Obsidian, which inherits no login
  // shell's PATH and so finds no mise shim — the plugin carries a resolveBun()
  // probe for exactly that reason. Spawning by name failed there *after* the
  // dashboard write, leaving the day archived and the page unturned.
  let proc;
  try {
    proc = Bun.spawnSync(
      [process.execPath, script, "--shift-only", "--verbose"],
      { env: process.env },
    );
  } catch (e) {
    // spawnSync throws rather than returning a non-zero exit when the binary
    // cannot be run at all, so the report below needs this to reach it.
    return `shift failed: ${(e as Error).message}`;
  }
  const out = proc.stdout.toString().trim();
  const err = proc.stderr.toString().trim();
  if (proc.exitCode !== 0) return `shift failed: ${err || out || "no output"}`;
  // The shift prints its own DRY RUN/APPLIED banner; only the detail is wanted.
  return out
    .split("\n")
    .filter((l) => l.trim() && !/^(DRY RUN|APPLIED)$/.test(l.trim()))
    .map((l) => l.trim())
    .join("; ");
}

// --- remove from the dashboard, bottom-up so indices stay valid ----------
if (!dryRun) {
  const sorted = [...deletions].sort((a, b) => b[0] - a[0]);
  const out = [...lines];
  for (const [from, to] of sorted) out.splice(from, to - from);

  // Several agents write this file. Compare against the bytes this run read
  // before overwriting them; a difference means someone else got there first,
  // and this is the operation whose job is to remove content.
  let now: string;
  try {
    now = readFileSync(dashboardPath, "utf8");
  } catch (e) {
    fail(`cannot re-read ${dashboardPath}: ${(e as Error).message}`);
  }
  if (now !== before) {
    fail(
      `${dashboardPath} changed while this run was working. Nothing written; run it again.`,
    );
  }
  writeFileSync(dashboardPath, collapseBlanks(out).join("\n"), "utf8");
}

// In a dry run the file still holds everything this run would remove, so asking
// the shift now would answer about the wrong file. Say what will follow instead.
const shifted = dryRun ? "" : turnThePage();

if (verbose || dryRun) {
  process.stdout.write(`${dryRun ? "DRY RUN" : "APPLIED"}\n`);
  for (const move of moves) {
    const what = move.wholeGroup
      ? "whole group"
      : `${move.archived.length} item(s)`;
    process.stdout.write(`  ${move.day} — ${move.client}: ${what}\n`);
  }
  for (const day of emptiedDays)
    process.stdout.write(`  day heading removed: ${day}\n`);
  for (const path of written) process.stdout.write(`  archive: ${path}\n`);
  if (snapshot) process.stdout.write(`  snapshot: ${snapshot}\n`);
  process.stdout.write(
    dryRun
      ? "  then turns the page if the day ends with nothing left to tick\n"
      : `  ${shifted}\n`,
  );
} else {
  process.stdout.write(shifted ? `Done; ${shifted}\n` : "Done\n");
}
