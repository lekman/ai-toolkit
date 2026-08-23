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
  existsSync,
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

const vault = config.vault;
const dashboardPath = join(vault, config.dashboard);
if (!existsSync(dashboardPath)) fail(`no dashboard at ${dashboardPath}`);

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

const lines = readFileSync(dashboardPath, "utf8").split("\n");

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

  if (existsSync(path)) {
    archive = readFileSync(path, "utf8").split("\n");
  } else {
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

// --- remove from the dashboard, bottom-up so indices stay valid ----------
if (!dryRun) {
  const sorted = [...deletions].sort((a, b) => b[0] - a[0]);
  const out = [...lines];
  for (const [from, to] of sorted) out.splice(from, to - from);

  writeFileSync(dashboardPath, collapseBlanks(out).join("\n"), "utf8");
}

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
} else {
  process.stdout.write("Done\n");
}
