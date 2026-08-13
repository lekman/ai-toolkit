#!/usr/bin/env bun
/**
 * Live ICS calendar query: fetch every feed in ~/.claude/calendars.json and
 * print the target day's shape — travel first, then meetings. No cache, no
 * index — each run fetches fresh, so the answer is never stale.
 *
 *   bun ics-today.ts [--date YYYY-MM-DD] [--config <path>]
 *
 * Config shape:
 *   { "timezone": "Europe/London",
 *     "calendars": [
 *       { "name": "Work", "url": "webcal://…" },
 *       { "name": "Trips", "url": "https://…", "kind": "travel" } ] }
 *
 * Correctness notes, in order of how often naive readers get them wrong:
 * - Multi-day events (travel!) count on every day they span, not just the
 *   start date. DTEND is exclusive for all-day events per RFC 5545.
 * - Recurring events (RRULE) occur on days that carry no VEVENT of their
 *   own. DAILY and WEEKLY rules (INTERVAL / BYDAY / UNTIL / COUNT, EXDATE)
 *   are expanded; anything else is surfaced as a "check manually" warning
 *   rather than silently dropped.
 */

import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

interface Calendar {
  kind?: "travel" | "default";
  name: string;
  url: string;
}
interface Config {
  calendars: Calendar[];
  timezone?: string;
}
interface VEvent {
  allDay: boolean;
  end?: Date;
  exdates: Set<string>;
  rrule?: Record<string, string>;
  rruleRaw?: string;
  start: Date;
  summary: string;
}
interface Occurrence {
  calendar: Calendar;
  label: string;
  sortKey: string;
}

const arg = (name: string): string | undefined => {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
};

const configPath = arg("config") ?? join(homedir(), ".claude/calendars.json");
const config: Config = JSON.parse(readFileSync(configPath, "utf8"));
const zone =
  config.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
const targetIso =
  arg("date") ??
  new Intl.DateTimeFormat("sv-SE", { timeZone: zone }).format(new Date());

const DAY_MS = 86_400_000;
const BYDAY: Record<string, number> = {
  FR: 5,
  MO: 1,
  SA: 6,
  SU: 0,
  TH: 4,
  TU: 2,
  WE: 3,
};

/**
 * Outlook publishes TZIDs as Windows time-zone names, not IANA. Map the
 * common ones; anything unknown falls back to the config zone (with a
 * warning) rather than crashing — a slightly-shifted time beats no answer.
 */
const WINDOWS_TZ: Record<string, string> = {
  "AUS Eastern Standard Time": "Australia/Sydney",
  "Central Europe Standard Time": "Europe/Budapest",
  "Central European Standard Time": "Europe/Warsaw",
  "Central Standard Time": "America/Chicago",
  "China Standard Time": "Asia/Shanghai",
  "Eastern Standard Time": "America/New_York",
  "FLE Standard Time": "Europe/Helsinki",
  "GMT Standard Time": "Europe/London",
  "GTB Standard Time": "Europe/Bucharest",
  "India Standard Time": "Asia/Kolkata",
  "Mountain Standard Time": "America/Denver",
  "Pacific Standard Time": "America/Los_Angeles",
  "Romance Standard Time": "Europe/Paris",
  "Singapore Standard Time": "Asia/Singapore",
  "Tokyo Standard Time": "Asia/Tokyo",
  UTC: "Etc/UTC",
  "W. Europe Standard Time": "Europe/Berlin",
};
const tzWarnings = new Set<string>();
const normalizeTz = (tzid: string): string => {
  if (WINDOWS_TZ[tzid]) return WINDOWS_TZ[tzid];
  try {
    new Intl.DateTimeFormat("sv-SE", { timeZone: tzid });
    return tzid;
  } catch {
    tzWarnings.add(`⚠ Unknown TZID "${tzid}" — times interpreted in ${zone}`);
    return zone;
  }
};

/** Offset (ms) of an IANA zone at a given UTC instant. */
const zoneOffset = (tz: string, at: Date): number => {
  const stamp = new Intl.DateTimeFormat("sv-SE", {
    day: "2-digit",
    hour: "2-digit",
    hour12: false,
    minute: "2-digit",
    month: "2-digit",
    second: "2-digit",
    timeZone: tz,
    year: "numeric",
  }).format(at);
  return new Date(`${stamp.replace(" ", "T")}Z`).getTime() - at.getTime();
};

/** Parse an ICS date or date-time (optionally zoned) into a UTC Date. */
const parseStamp = (
  value: string,
  tzid?: string,
): { allDay: boolean; date: Date } => {
  const dateOnly = /^(\d{4})(\d{2})(\d{2})$/.exec(value);
  if (dateOnly) {
    return {
      allDay: true,
      date: new Date(`${dateOnly[1]}-${dateOnly[2]}-${dateOnly[3]}T00:00:00Z`),
    };
  }
  const match = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z?)$/.exec(value);
  if (!match) return { allDay: false, date: new Date(NaN) };
  const naive = new Date(
    `${match[1]}-${match[2]}-${match[3]}T${match[4]}:${match[5]}:${match[6]}Z`,
  );
  if (match[7] === "Z") return { allDay: false, date: naive };
  return {
    allDay: false,
    date: new Date(
      naive.getTime() - zoneOffset(tzid ? normalizeTz(tzid) : zone, naive),
    ),
  };
};

/** Unfold folded lines and split a feed into VEVENT blocks. */
const eventBlocks = (ics: string): string[][] => {
  const lines = ics
    .replace(/\r\n[ \t]/g, "")
    .replace(/\r/g, "")
    .split("\n");
  const blocks: string[][] = [];
  let current: string[] | null = null;
  for (const line of lines) {
    if (line === "BEGIN:VEVENT") current = [];
    else if (line === "END:VEVENT" && current) {
      blocks.push(current);
      current = null;
    } else if (current) current.push(line);
  }
  return blocks;
};

const parseEvent = (block: string[]): VEvent | null => {
  const event: VEvent = {
    allDay: false,
    exdates: new Set(),
    start: new Date(NaN),
    summary: "(no title)",
  };
  for (const line of block) {
    const sep = line.indexOf(":");
    if (sep < 0) continue;
    const [prop, ...params] = line.slice(0, sep).split(";");
    const value = line.slice(sep + 1);
    const tzid = params.find((param) => param.startsWith("TZID="))?.slice(5);
    if (prop === "DTSTART") {
      const parsed = parseStamp(value, tzid);
      event.start = parsed.date;
      event.allDay = parsed.allDay;
    } else if (prop === "DTEND") {
      event.end = parseStamp(value, tzid).date;
    } else if (prop === "SUMMARY") {
      event.summary = value.replace(/\\,/g, ",").replace(/\\n/g, " ").trim();
    } else if (prop === "RRULE") {
      event.rruleRaw = value;
      event.rrule = Object.fromEntries(
        value.split(";").map((kv) => kv.split("=") as [string, string]),
      );
    } else if (prop === "EXDATE") {
      for (const ex of value.split(",")) event.exdates.add(ex.slice(0, 8));
    }
  }
  return Number.isNaN(event.start.getTime()) ? null : event;
};

/** Local calendar date (YYYY-MM-DD) of an instant in the config zone. */
const localDate = (at: Date): string =>
  new Intl.DateTimeFormat("sv-SE", { timeZone: zone }).format(at);
const localTime = (at: Date): string =>
  new Intl.DateTimeFormat("sv-SE", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: zone,
  }).format(at);
const localDow = (at: Date): number =>
  BYDAY[
    new Intl.DateTimeFormat("en-US", { timeZone: zone, weekday: "short" })
      .format(at)
      .slice(0, 2)
      .toUpperCase()
  ] ?? 0;

/** Last local day an event touches. All-day DTEND is exclusive (RFC 5545). */
const lastDay = (event: VEvent, start: Date): string => {
  if (!event.end) return localDate(start);
  const duration = event.end.getTime() - event.start.getTime();
  const end = new Date(
    start.getTime() + duration - (event.allDay ? DAY_MS : 1),
  );
  return localDate(end);
};

/**
 * If the event (or one of its recurrences) touches the target day, return
 * that occurrence's start; "unsupported" for RRULEs we do not expand.
 */
const occurrenceOn = (
  event: VEvent,
  target: string,
): Date | "unsupported" | null => {
  const spans = (start: Date): boolean =>
    localDate(start) <= target && target <= lastDay(event, start);

  if (!event.rrule) return spans(event.start) ? event.start : null;

  const freq = event.rrule["FREQ"];
  const interval = Number(event.rrule["INTERVAL"] ?? "1");
  const count = event.rrule["COUNT"] ? Number(event.rrule["COUNT"]) : Infinity;
  const until = event.rrule["UNTIL"]
    ? parseStamp(event.rrule["UNTIL"]).date
    : null;

  // An expired series cannot occur on the target day — no warning needed
  // even for otherwise-unsupported rules; it is simply over.
  if (
    until &&
    until.getTime() < new Date(`${target}T00:00:00Z`).getTime() - DAY_MS
  )
    return null;

  if (freq === "MONTHLY") {
    const ordinalRules = event.rrule["BYDAY"]?.split(",").map((entry) => {
      const match = /^(-?\d)(\w{2})$/.exec(entry);
      return match
        ? { dow: BYDAY[match[2]] ?? -1, nth: Number(match[1]) }
        : null;
    });
    if (!ordinalRules || ordinalRules.some((rule) => rule === null))
      return "unsupported";
    const targetDate = new Date(`${target}T12:00:00Z`);
    if (targetDate.getTime() < event.start.getTime() - DAY_MS) return null;
    if (count !== Infinity) return "unsupported"; // monthly COUNT: rare, punt loudly
    const monthsSince =
      (targetDate.getUTCFullYear() - event.start.getUTCFullYear()) * 12 +
      (targetDate.getUTCMonth() - event.start.getUTCMonth());
    if (monthsSince % interval !== 0) return null;
    const dayOfMonth = targetDate.getUTCDate();
    const dow = localDow(targetDate);
    const matches = ordinalRules.some((rule) => {
      if (!rule || rule.dow !== dow) return false;
      if (rule.nth > 0) return Math.ceil(dayOfMonth / 7) === rule.nth;
      const daysInMonth = new Date(
        Date.UTC(targetDate.getUTCFullYear(), targetDate.getUTCMonth() + 1, 0),
      ).getUTCDate();
      return Math.ceil((daysInMonth - dayOfMonth + 1) / 7) === -rule.nth;
    });
    if (!matches || event.exdates.has(target.replaceAll("-", ""))) return null;
    // Occurrence at DTSTART's wall-clock time on the target day.
    const clockMs =
      event.start.getTime() -
      new Date(`${localDate(event.start)}T00:00:00Z`).getTime() +
      zoneOffset(zone, event.start);
    return new Date(
      new Date(`${target}T00:00:00Z`).getTime() -
        zoneOffset(zone, targetDate) +
        clockMs,
    );
  }

  if (freq !== "DAILY" && freq !== "WEEKLY") return "unsupported";
  const byday = event.rrule["BYDAY"]?.split(",").map((day) => BYDAY[day] ?? -1);

  const horizon = new Date(`${target}T23:59:59Z`).getTime() + DAY_MS;
  let occurrences = 0;
  for (
    let t = event.start.getTime();
    t <= horizon && occurrences < count;
    t += DAY_MS
  ) {
    const cursor = new Date(t);
    const days = Math.round((t - event.start.getTime()) / DAY_MS);
    let occurs: boolean;
    if (freq === "DAILY") {
      occurs = days % interval === 0;
    } else {
      const sameWeekday = byday
        ? byday.includes(localDow(cursor))
        : days % 7 === 0;
      occurs = sameWeekday && Math.floor(days / 7) % interval === 0;
    }
    if (!occurs) continue;
    if (until && t > until.getTime()) return null;
    occurrences += 1;
    if (event.exdates.has(localDate(cursor).replaceAll("-", ""))) continue;
    if (spans(cursor)) return cursor;
    if (localDate(cursor) > target) return null;
  }
  return null;
};

const describe = (
  event: VEvent,
  start: Date,
  calendar: Calendar,
): Occurrence => {
  const startDay = localDate(start);
  const endDay = lastDay(event, start);
  const spanning = startDay !== endDay;
  let label: string;
  if (event.allDay || spanning) {
    const span = spanning ? `  (${startDay} → ${endDay})` : "";
    label = `all-day  ${event.summary}${span}  [${calendar.name}]`;
  } else {
    const duration = event.end
      ? event.end.getTime() - event.start.getTime()
      : 0;
    const end =
      duration > 0 ? `–${localTime(new Date(start.getTime() + duration))}` : "";
    label = `${localTime(start)}${end}  ${event.summary}  [${calendar.name}]`;
  }
  return {
    calendar,
    label,
    sortKey: event.allDay || spanning ? "00:00" : localTime(start),
  };
};

const fetchIcs = async (url: string): Promise<string> => {
  const response = await fetch(url.replace(/^webcal:/, "https:"), {
    signal: AbortSignal.timeout(8000),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.text();
};

const travel: Occurrence[] = [];
const meetings: Occurrence[] = [];
const warnings: string[] = [];

await Promise.all(
  config.calendars.map(async (calendar) => {
    let ics: string;
    try {
      ics = await fetchIcs(calendar.url);
    } catch (error) {
      warnings.push(
        `⚠ ${calendar.name}: fetch failed (${String(error)}) — this day view is INCOMPLETE`,
      );
      return;
    }
    for (const block of eventBlocks(ics)) {
      const event = parseEvent(block);
      if (!event) continue;
      const hit = occurrenceOn(event, targetIso);
      if (hit === null) continue;
      if (hit === "unsupported") {
        warnings.push(
          `⚠ ${calendar.name}: "${event.summary}" recurs (${event.rruleRaw ?? ""}) — unsupported rule, check manually`,
        );
        continue;
      }
      (calendar.kind === "travel" ? travel : meetings).push(
        describe(event, hit, calendar),
      );
    }
  }),
);

const bySort = (a: Occurrence, b: Occurrence): number =>
  a.sortKey.localeCompare(b.sortKey);

console.log(`Day shape ${targetIso} (${zone}):`);
if (travel.length > 0) {
  console.log("Travel:");
  for (const occurrence of travel.sort(bySort))
    console.log(`  ${occurrence.label}`);
}
console.log("Meetings:");
if (meetings.length === 0) console.log("  none");
for (const occurrence of meetings.sort(bySort))
  console.log(`  ${occurrence.label}`);
for (const warning of [...warnings, ...tzWarnings]) console.log(warning);
