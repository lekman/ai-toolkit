#!/usr/bin/env bun
/**
 * Day view over the configured O365 calendars.
 *
 *   bun src/day.ts --date 2026-08-10
 *
 * Output sections, in order:
 *   Meetings  — main-calendar events WITH attendees (times, title)
 *   Todos     — main-calendar events WITHOUT attendees: the subject is the
 *               task (the operator's calendar convention); a non-empty body
 *               is shown indented as context
 *   Admin     — events from kind:"admin" calendars, rendered as a checklist
 *
 * Graph expands recurrences server-side via calendarView, so recurring
 * admin tasks need no RRULE handling here.
 */
import { AuthError, graph, loadConfig } from "./client";

interface GraphEvent {
  subject: string;
  isAllDay: boolean;
  start: { dateTime: string };
  end: { dateTime: string };
  attendees?: unknown[];
  body?: { content?: string };
}

function timeOf(e: GraphEvent): string {
  if (e.isAllDay) return "all day    ";
  return `${e.start.dateTime.slice(11, 16)}–${e.end.dateTime.slice(11, 16)}`;
}

const dateArgIndex = process.argv.indexOf("--date");
const date =
  (dateArgIndex > -1
    ? process.argv[dateArgIndex + 1]
    : new Date().toISOString().slice(0, 10)) ?? "";
if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
  console.error("Usage: bun src/day.ts --date YYYY-MM-DD");
  process.exit(1);
}

try {
  const config = loadConfig();
  const timezone = config.timezone ?? "Europe/London";

  const all = await graph<{ value: Array<{ name: string; id: string }> }>(
    "/me/calendars",
    timezone,
  );
  const byName = new Map(all.value.map((c) => [c.name, c.id]));

  const meetings: GraphEvent[] = [];
  const todos: GraphEvent[] = [];
  const admin: Array<{ calendar: string; event: GraphEvent }> = [];

  for (const cal of config.calendars) {
    const id = byName.get(cal.name);
    if (!id) {
      console.log(
        `⚠ Calendar "${cal.name}" not found in mailbox — day view incomplete`,
      );
      continue;
    }
    // calendarView bounds are exclusive-ish on the end; a full local day is
    // [00:00, 00:00 next day). Times come back already in `timezone`.
    const path =
      `/me/calendars/${id}/calendarView` +
      `?startDateTime=${date}T00:00:00&endDateTime=${date}T23:59:59` +
      `&$select=subject,start,end,attendees,isAllDay,body&$top=50&$orderby=start/dateTime`;
    const page = await graph<{ value: GraphEvent[] }>(path, timezone);

    for (const event of page.value) {
      if (cal.kind === "admin") admin.push({ calendar: cal.name, event });
      else if ((event.attendees?.length ?? 0) > 0) meetings.push(event);
      else todos.push(event);
    }
  }

  console.log(`Day view ${date} (${timezone}):`);

  if (meetings.length > 0) {
    console.log("Meetings:");
    for (const e of meetings) console.log(`  ${timeOf(e)}  ${e.subject}`);
  }

  if (todos.length > 0) {
    console.log("Todos (from calendar):");
    for (const e of todos) {
      console.log(
        `  - [ ] ${e.subject}  (${e.isAllDay ? "all day" : e.start.dateTime.slice(11, 16)})`,
      );
      const context = (e.body?.content ?? "").trim();
      if (context)
        console.log(`        ${(context.split("\n")[0] ?? "").slice(0, 120)}`);
    }
  }

  if (admin.length > 0) {
    console.log("Admin:");
    for (const { calendar, event } of admin)
      console.log(`  - [ ] ${event.subject}  [${calendar}]`);
  }

  if (meetings.length + todos.length + admin.length === 0) {
    console.log("  (no events)");
  }
} catch (error) {
  if (error instanceof AuthError) {
    console.error(`⚠ ${error.message} — this day view is INCOMPLETE`);
    process.exit(1);
  }
  throw error;
}
