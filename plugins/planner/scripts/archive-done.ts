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
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
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
    return readdirSync(vault).filter((f) =>
      /^Dashboard \d|conflicted/i.test(f),
    );
  } catch {
    return [];
  }
})();
if (conflicts.length)
  fail(`iCloud conflict copies present: ${conflicts.join(", ")}`);

const lines = readFileSync(dashboardPath, "utf8").split("\n");

const isDayHeading = (l: string) =>
  /^#{2,3} [A-Z][a-z]+day \d{1,2} [A-Z][a-z]+/.test(l);
const isClientHeading = (l: string) => /^#### /.test(l);
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
    if (isDayHeading(lines[j])) {
      end = j;
      break;
    }
  }
  const groups: Group[] = [];
  for (let j = i + 1; j < end; j++) {
    if (!isClientHeading(lines[j])) continue;
    let gEnd = end;
    for (let k = j + 1; k < end; k++) {
      if (isClientHeading(lines[k])) {
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
} else {
  process.stdout.write("Done\n");
}
