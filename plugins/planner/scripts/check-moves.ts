#!/usr/bin/env bun
/**
 * check-moves — prove a planning run only moved items.
 *
 * Compares a copy of the vault files taken before the run with the same files
 * after it. Two checks:
 *
 *   1. Items. Every checkbox line, with its `"> "` prefix and indentation
 *      stripped, must appear the same number of times before and after, summed
 *      across all the files given. An item that moved from the dashboard to the
 *      work log counts once on each side. An item that was deleted, ticked,
 *      reworded or merged does not. A `🔄` claim marker is ignored, because
 *      the roll drops it.
 *   2. Days. A day heading may disappear only if it held no open item before
 *      the run, which is what archiving an emptied day looks like, or if it is
 *      earlier than `--today`, which is what a roll looks like. Check 1 still
 *      proves that its open items went somewhere. With
 *      `--today`, the dashboard must also have exactly one unprefixed day
 *      heading and it must be that day, and Tomorrow must hold at most one day
 *      (none only when Future holds no day either).
 *
 * A file missing on one side counts as empty, so a work log the run creates
 * is fine.
 *
 * Usage:
 *   bun check-moves.ts <before_dir> <after_dir> <file> [<file> …]
 *     [--dashboard Dashboard.md] [--today "Tuesday 29 September"]
 *
 * Files are paths relative to both directories. Exit 0 prints `OK <n> items`;
 * exit 1 prints one line per problem.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const stripQuotes = (l: string) => l.replace(/^(?:>\s?)+/, "");
const ITEM = /^\s*- \[[ xX]\] /;
const OPEN = /^\s*- \[ \] /;
const DAY = /^#{2,3} ([A-Z][a-z]+day \d{1,2} [A-Z][a-z]+)/;

function read(path: string): string[] {
  return existsSync(path) ? readFileSync(path, "utf8").split("\n") : [];
}

/** Count item lines, normalised so a move between bands is not a change. */
function items(lines: string[], into: Map<string, number>): void {
  for (const line of lines) {
    const s = stripQuotes(line).trimEnd();
    if (!ITEM.test(s)) continue;
    // The roll drops a 🔄 claim on purpose, because the claiming session has
    // ended. The item is otherwise unchanged, so the marker is not compared.
    const key = s
      .trimStart()
      .replace(/^- \[X\]/, "- [x]")
      .replace(/^(- \[[ x]\]) 🔄\s*/u, "$1 ");
    into.set(key, (into.get(key) ?? 0) + 1);
  }
}

/** Day heading → whether it holds an open item, for one dashboard. */
function days(lines: string[]): Map<string, boolean> {
  const out = new Map<string, boolean>();
  let current: null | string = null;
  for (const line of lines) {
    const s = stripQuotes(line);
    const day = s.match(DAY);
    if (day) {
      current = day[1];
      out.set(current, out.get(current) ?? false);
    } else if (/^#{2,3} /.test(s)) {
      current = null;
    } else if (current && OPEN.test(s)) {
      out.set(current, true);
    }
  }
  return out;
}

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

/**
 * Whether day heading `a` is earlier than `b`. Headings carry no year, so a
 * gap of more than six months is read as crossing the new year.
 */
function isEarlier(a: string, b: string): boolean {
  const at = (d: string) => {
    const m = d.match(/(\d{1,2}) ([A-Z][a-z]+)$/);
    return m ? MONTHS.indexOf(m[2]) * 31 + Number(m[1]) : NaN;
  };
  const diff = at(b) - at(a);
  if (Number.isNaN(diff)) return false;
  if (diff > 186) return false;
  if (diff < -186) return true;
  return diff > 0;
}

/** The unprefixed day headings, and the days inside each band. */
function bands(lines: string[]) {
  const today: string[] = [];
  const band: Record<string, string[]> = { Future: [], Tomorrow: [] };
  let inBand: null | string = null;
  for (const line of lines) {
    // Any `> [!note]- …` opens a band; only Tomorrow and Future are counted.
    // An unprefixed line, blank or not, closes it.
    const open = line.match(/^> \[!note\]- (\S+)/);
    if (open) {
      inBand = open[1] in band ? open[1] : null;
      continue;
    }
    if (!line.startsWith(">")) inBand = null;
    const plain = line.match(DAY);
    if (plain) today.push(plain[1]);
    const quoted = line.match(/^> (#{2,3} .*)/)?.[1].match(DAY);
    if (quoted && inBand) band[inBand].push(quoted[1]);
  }
  return { future: band.Future, today, tomorrow: band.Tomorrow };
}

const argv = process.argv.slice(2);
const flag = (name: string) => {
  const i = argv.indexOf(name);
  if (i < 0) return undefined;
  const value = argv[i + 1];
  argv.splice(i, 2);
  return value;
};
const dashboard = flag("--dashboard") ?? "Dashboard.md";
const today = flag("--today");
const [beforeDir, afterDir, ...files] = argv;
if (!beforeDir || !afterDir || files.length === 0) {
  process.stderr.write(
    "usage: check-moves.ts <before_dir> <after_dir> <file>… [--dashboard f] [--today d]\n",
  );
  process.exit(2);
}

const problems: string[] = [];

const before = new Map<string, number>();
const after = new Map<string, number>();
for (const f of files) {
  items(read(join(beforeDir, f)), before);
  items(read(join(afterDir, f)), after);
}
for (const key of new Set([...before.keys(), ...after.keys()])) {
  const diff = (after.get(key) ?? 0) - (before.get(key) ?? 0);
  if (diff < 0) problems.push(`LOST:   ${key.slice(0, 100)}`);
  if (diff > 0) problems.push(`GAINED: ${key.slice(0, 100)}`);
}

const dashBefore = read(join(beforeDir, dashboard));
const dashAfter = read(join(afterDir, dashboard));
const daysAfter = days(dashAfter);
for (const [day, hadOpen] of days(dashBefore)) {
  const rolled = today !== undefined && isEarlier(day, today);
  if (hadOpen && !rolled && !daysAfter.has(day))
    problems.push(`DAY LOST: ${day} held open items`);
}

if (today) {
  const b = bands(dashAfter);
  if (b.today.length !== 1 || b.today[0] !== today)
    problems.push(
      `TODAY: expected one unprefixed day "${today}", found [${b.today.join(", ")}]`,
    );
  if (b.tomorrow.length > 1)
    problems.push(`TOMORROW: holds ${b.tomorrow.length} days`);
  if (b.tomorrow.length === 0 && b.future.length > 0)
    problems.push("TOMORROW: empty while Future holds days");
}

if (problems.length) {
  process.stdout.write(problems.join("\n") + "\n");
  process.exit(1);
}
let total = 0;
for (const n of before.values()) total += n;
process.stdout.write(`OK ${total} items\n`);
