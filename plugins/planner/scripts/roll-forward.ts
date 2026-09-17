#!/usr/bin/env bun
/**
 * roll-forward — move today's unfinished items into Tomorrow, then turn the page.
 *
 * Two operations, in this order:
 *
 *   1. Roll. Every open `- [ ]` item under today's unprefixed day heading moves
 *      into the day inside `> [!note]- Tomorrow`, under the same client group,
 *      gaining one `"> "` level. A `🔄` claim marker is dropped on the way: the
 *      session that took the task has ended.
 *   2. Shift. Only when today's section is left with no items at all does the
 *      two-stage day shift run — Tomorrow becomes today, the earliest dated
 *      Future day becomes Tomorrow.
 *
 * The shift is deliberately conditional. Promoting Tomorrow while today's
 * section still exists would leave two unprefixed day headings, and the
 * structure allows exactly one. Ticked items left behind are `archive-done.ts`'s
 * to move; run that, then run this again to turn the page.
 *
 * Runs across every client, like archive-done.ts and unlike the per-client
 * planner skills: a day's work spans clients and half a rolled day is worse
 * than none.
 *
 * Usage:
 *   bun roll-forward.ts               # apply, print "Done" or "Nothing to roll"
 *   bun roll-forward.ts --dry-run     # report what would move, change nothing
 *   bun roll-forward.ts --verbose     # per-client detail and what shifted
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
}

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const verbose = args.includes("--verbose");

function fail(message: string): never {
  process.stderr.write(`roll-forward: ${message}\n`);
  process.exit(1);
}

const configPath = join(homedir(), ".claude", "obsidian.json");
let config: Config;
try {
  config = JSON.parse(readFileSync(configPath, "utf8"));
} catch (e) {
  fail(`cannot read ${configPath}: ${(e as Error).message}`);
}

// DASHBOARD_PATH points the run at a fixture instead of the vault. The tests
// need it; nothing else sets it.
const dashboardPath =
  process.env.DASHBOARD_PATH ?? join(config.vault, config.dashboard);
const vault = dirname(dashboardPath);
if (!existsSync(dashboardPath)) fail(`no dashboard at ${dashboardPath}`);

// An iCloud conflict copy means two versions disagree; never edit blind.
const conflicts = (() => {
  try {
    return readdirSync(vault).filter((f) =>
      /(?:^Dashboard \d)|(?:conflicted)/i.test(f),
    );
  } catch {
    return [];
  }
})();
if (conflicts.length)
  fail(`iCloud conflict copies present: ${conflicts.join(", ")}`);

/* ------------------------------------------------------------------ shapes */

const strip = (l: string) => l.replace(/^(?:> ?)+/, "");
// "Unscheduled — no day assigned" is a day heading in the file but not a date,
// and must never be promoted into Tomorrow.
const isDatedHeading = (l: string) =>
  /^#{2,3} [A-Z][a-z]+day \d{1,2} [A-Z][a-z]+/.test(strip(l));
const isAnyDayHeading = (l: string) => /^#{2,3} \S/.test(strip(l));
const isClientHeading = (l: string) => /^#### /.test(strip(l));
const isBandStart = (l: string) => /^> \[!note\]- /.test(l);
const isItem = (l: string) => /^- \[[ x]\]/.test(strip(l));
const isOpen = (l: string) => /^- \[ \]/.test(strip(l));
const clientName = (l: string) =>
  strip(l).replace(/^####\s*/, "").replace(/\*\*/g, "").trim();

/** Drop the claim marker, and the double space it leaves behind. */
const unclaim = (l: string) => l.replace(/🔄\s*/u, "").replace(/\]\s{2,}/, "] ");

function focusBounds(lines: string[]): [number, number] {
  const start = lines.findIndex((l) => /^## Focus\s*$/.test(l));
  if (start === -1) fail("no '## Focus' section in the dashboard");
  for (let i = start + 1; i < lines.length; i++) {
    if (/^## /.test(lines[i])) return [start, i];
  }
  return [start, lines.length];
}

/** A callout runs until the first line that is not `>`-prefixed. */
function bandEnd(lines: string[], start: number, limit: number): number {
  for (let i = start + 1; i < limit; i++) {
    if (!lines[i].startsWith(">")) return i;
  }
  return limit;
}

interface Layout {
  focusStart: number;
  focusEnd: number;
  todayIndex: number;
  todayEnd: number;
  tomorrowIndex: number;
  tomorrowEnd: number;
  futureIndex: number;
  futureEnd: number;
}

function layout(lines: string[]): Layout {
  const [focusStart, focusEnd] = focusBounds(lines);

  let todayIndex = -1;
  for (let i = focusStart + 1; i < focusEnd; i++) {
    if (!lines[i].startsWith(">") && isAnyDayHeading(lines[i])) {
      todayIndex = i;
      break;
    }
  }
  let todayEnd = focusEnd;
  if (todayIndex >= 0) {
    for (let i = todayIndex + 1; i < focusEnd; i++) {
      if (isBandStart(lines[i]) || (!lines[i].startsWith(">") && isAnyDayHeading(lines[i]))) {
        todayEnd = i;
        break;
      }
    }
  }

  const tomorrowIndex = lines.findIndex(
    (l, i) => i > focusStart && i < focusEnd && /^> \[!note\]- Tomorrow/.test(l),
  );
  const futureIndex = lines.findIndex(
    (l, i) => i > focusStart && i < focusEnd && /^> \[!note\]- Future/.test(l),
  );

  return {
    focusStart,
    focusEnd,
    todayIndex,
    todayEnd,
    tomorrowIndex,
    tomorrowEnd: tomorrowIndex >= 0 ? bandEnd(lines, tomorrowIndex, focusEnd) : -1,
    futureIndex,
    futureEnd: futureIndex >= 0 ? bandEnd(lines, futureIndex, focusEnd) : -1,
  };
}

/** The next Mon–Fri after today, formatted as the dashboard writes days. */
function nextWorkingDay(from = new Date()): string {
  const d = new Date(from);
  do {
    d.setDate(d.getDate() + 1);
  } while (d.getDay() === 0 || d.getDay() === 6);
  const weekday = d.toLocaleDateString("en-GB", { weekday: "long" });
  const month = d.toLocaleDateString("en-GB", { month: "long" });
  return `${weekday} ${d.getDate()} ${month}`;
}

/* -------------------------------------------------------------------- roll */

interface Rolled {
  client: string;
  text: string;
}

function rollOpenItems(input: string[]): { lines: string[]; rolled: Rolled[] } {
  const lines = [...input];
  const rolled: Rolled[] = [];
  let l = layout(lines);
  if (l.todayIndex < 0) return { lines, rolled };

  // Collect today's open items by client, and the lines they occupy.
  const byClient = new Map<string, string[]>();
  const removals: number[] = [];
  let client = "";
  for (let i = l.todayIndex + 1; i < l.todayEnd; i++) {
    if (lines[i].startsWith(">")) continue; // an intention callout, not an item
    if (isClientHeading(lines[i])) {
      client = clientName(lines[i]);
      continue;
    }
    if (isOpen(lines[i])) {
      const text = unclaim(lines[i]);
      if (!byClient.has(client)) byClient.set(client, []);
      byClient.get(client)!.push(text);
      rolled.push({ client: client || "No client", text });
      removals.push(i);
    }
  }
  if (!removals.length) return { lines, rolled };

  // Remove from today first, bottom-up, so the indices stay valid.
  for (let i = removals.length - 1; i >= 0; i--) lines.splice(removals[i], 1);

  pruneEmptiedGroups(lines);

  // The Tomorrow band has to exist before anything can go into it.
  l = layout(lines);
  if (l.tomorrowIndex < 0) {
    const at = l.futureIndex >= 0 ? l.futureIndex : l.focusEnd;
    lines.splice(at, 0, "> [!note]- Tomorrow", ">", "");
    l = layout(lines);
  }

  // …and so does a day inside it.
  let hasDay = false;
  for (let i = l.tomorrowIndex + 1; i < l.tomorrowEnd; i++) {
    if (isAnyDayHeading(lines[i])) {
      hasDay = true;
      break;
    }
  }
  if (!hasDay) {
    lines.splice(l.tomorrowIndex + 1, 0, ">", `> ### ${nextWorkingDay()}`);
    l = layout(lines);
  }

  // Insert each client's items into the matching group inside that day.
  for (const [name, items] of byClient) {
    l = layout(lines);
    const dayStart = (() => {
      for (let i = l.tomorrowIndex + 1; i < l.tomorrowEnd; i++) {
        if (isAnyDayHeading(lines[i])) return i;
      }
      return -1;
    })();
    if (dayStart < 0) break;

    let groupStart = -1;
    let groupEnd = l.tomorrowEnd;
    for (let i = dayStart + 1; i < l.tomorrowEnd; i++) {
      if (!isClientHeading(lines[i])) continue;
      if (groupStart >= 0) {
        groupEnd = i;
        break;
      }
      if (clientName(lines[i]) === name) groupStart = i;
    }

    const body = items.map((t) => `> ${t}`);
    if (groupStart < 0) {
      // No group for this client tomorrow: create one at the end of the day.
      let at = l.tomorrowEnd;
      while (at > dayStart + 1 && lines[at - 1].trim() === ">") at--;
      const heading = name ? `> #### **${name}**` : "";
      lines.splice(at, 0, ...(heading ? [">", heading, ">"] : [">"]), ...body);
    } else {
      // Append after the group's last item, keeping the operator's order.
      let at = groupStart + 1;
      for (let i = groupStart + 1; i < groupEnd; i++) if (isItem(lines[i])) at = i + 1;
      lines.splice(at, 0, ...body);
    }
  }

  return { lines, rolled };
}

/**
 * A group the roll emptied keeps its heading, and archive-done.ts will not take
 * it — that skips any group with nothing ticked. Left alone it holds the day
 * open forever and the shift never fires. So the roll clears what it emptied,
 * but only when the heading and blank lines are all that is left: an intention
 * callout or a framing paragraph is the operator's prose, and prose outranks
 * the tidying.
 */
function pruneEmptiedGroups(lines: string[]): void {
  const l = layout(lines);
  if (l.todayIndex < 0) return;

  const starts: number[] = [];
  for (let i = l.todayIndex + 1; i < l.todayEnd; i++) {
    if (!lines[i].startsWith(">") && isClientHeading(lines[i])) starts.push(i);
  }

  for (let s = starts.length - 1; s >= 0; s--) {
    const start = starts[s];
    let end = l.todayEnd;
    for (let i = start + 1; i < l.todayEnd; i++) {
      if (isBandStart(lines[i]) || isAnyDayHeading(lines[i]) || isClientHeading(lines[i])) {
        end = i;
        break;
      }
    }
    let onlyBlanks = true;
    for (let i = start + 1; i < end; i++) {
      if (lines[i].trim() !== "") {
        onlyBlanks = false;
        break;
      }
    }
    if (onlyBlanks) lines.splice(start, end - start);
  }

  // Splicing leaves runs of blank lines behind; the day should read as it did.
  const after = layout(lines);
  if (after.todayIndex < 0) return;
  for (let i = after.todayEnd - 1; i > after.todayIndex; i--) {
    if (lines[i].trim() === "" && lines[i - 1].trim() === "") lines.splice(i, 1);
  }
}

/* ------------------------------------------------------------------- shift */

interface Shift {
  promoted?: string;
  newTomorrow?: string;
  reason?: string;
}

function shiftDays(input: string[]): { lines: string[]; shift: Shift } {
  const lines = [...input];
  let l = layout(lines);

  // The shift presupposes an empty today: the structure allows exactly one
  // unprefixed day heading, so promoting while today still holds anything —
  // items, a leftover group, the operator's prose — would make two. Whatever
  // is left is archive-done.ts's to move.
  if (l.todayIndex >= 0) {
    let held = "";
    for (let i = l.todayIndex + 1; i < l.todayEnd; i++) {
      if (lines[i].trim() === "") continue;
      held = isItem(lines[i]) ? "today still has items" : "today still has content";
      break;
    }
    if (held) return { lines, shift: { reason: held } };
    // Nothing but the heading: the day is finished, so it goes.
    lines.splice(l.todayIndex, l.todayEnd - l.todayIndex);
    l = layout(lines);
  }
  if (l.tomorrowIndex < 0) return { lines, shift: { reason: "no Tomorrow band" } };

  // Stage 1: Tomorrow → today.
  let dayStart = -1;
  for (let i = l.tomorrowIndex + 1; i < l.tomorrowEnd; i++) {
    if (isAnyDayHeading(lines[i])) {
      dayStart = i;
      break;
    }
  }
  if (dayStart < 0) return { lines, shift: { reason: "Tomorrow is empty" } };

  let dayEnd = l.tomorrowEnd;
  while (dayEnd > dayStart && lines[dayEnd - 1].trim() === ">") dayEnd--;
  const promoted = strip(lines[dayStart]).replace(/^#{2,3}\s*/, "").trim();
  const section = lines.slice(dayStart, dayEnd).map((x) => x.replace(/^> ?/, ""));
  lines.splice(dayStart, dayEnd - dayStart);

  l = layout(lines);
  lines.splice(l.tomorrowIndex, 0, ...section, "");

  // Stage 2: earliest dated Future day → Tomorrow, at the same depth.
  l = layout(lines);
  const shift: Shift = { promoted };
  if (l.futureIndex >= 0) {
    let fStart = -1;
    for (let i = l.futureIndex + 1; i < l.futureEnd; i++) {
      if (isDatedHeading(lines[i])) {
        fStart = i;
        break;
      }
    }
    if (fStart >= 0) {
      let fEnd = l.futureEnd;
      for (let i = fStart + 1; i < l.futureEnd; i++) {
        if (isAnyDayHeading(lines[i])) {
          fEnd = i;
          break;
        }
      }
      while (fEnd > fStart && lines[fEnd - 1].trim() === ">") fEnd--;
      shift.newTomorrow = strip(lines[fStart]).replace(/^#{2,3}\s*/, "").trim();
      const moved = lines.slice(fStart, fEnd);
      lines.splice(fStart, fEnd - fStart);
      l = layout(lines);
      lines.splice(l.tomorrowIndex + 1, 0, ">", ...moved);
    }
  }

  return { lines, shift };
}

/**
 * Splicing days in and out leaves doubled blank lines inside the callouts —
 * a lone `>` is a blank line, and two of them read as a paragraph break the
 * operator did not write. A trailing one at the end of a band is the same
 * noise. Collapse both, inside `## Focus` only.
 */
function tidyBands(input: string[]): string[] {
  const lines = [...input];
  const [start, end] = focusBounds(lines);
  for (let i = end - 1; i > start; i--) {
    const blank = lines[i].trim() === ">";
    if (!blank) continue;
    const nextEndsBand = i + 1 >= end || !lines[i + 1].startsWith(">");
    if (lines[i - 1].trim() === ">" || nextEndsBand) lines.splice(i, 1);
  }
  return lines;
}

/* ------------------------------------------------------------------- write */

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

const original = readFileSync(dashboardPath, "utf8").split("\n");
const { lines: afterRoll, rolled } = rollOpenItems(original);
const { lines: shifted, shift } = shiftDays(afterRoll);
const final = tidyBands(shifted);

if (rolled.length === 0 && !shift.promoted) {
  process.stdout.write("Nothing to roll\n");
  process.exit(0);
}

let snapshot = "";
if (!dryRun) {
  snapshot = snapshotDashboard();
  writeFileSync(dashboardPath, final.join("\n"), "utf8");
}

if (verbose || dryRun) {
  process.stdout.write(`${dryRun ? "DRY RUN" : "APPLIED"}\n`);
  const counts = new Map<string, number>();
  for (const r of rolled) counts.set(r.client, (counts.get(r.client) ?? 0) + 1);
  for (const [client, n] of counts)
    process.stdout.write(`  rolled — ${client}: ${n} item(s)\n`);
  if (shift.promoted) process.stdout.write(`  promoted to today: ${shift.promoted}\n`);
  if (shift.newTomorrow) process.stdout.write(`  new tomorrow: ${shift.newTomorrow}\n`);
  if (shift.reason) process.stdout.write(`  no shift: ${shift.reason}\n`);
  if (snapshot) process.stdout.write(`  snapshot: ${snapshot}\n`);
} else {
  process.stdout.write("Done\n");
}
