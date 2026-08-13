/**
 * Parser for the Obsidian `Dashboard.md` Focus log.
 *
 * The file's shape, which this parser depends on:
 *
 *   ## Focus
 *   ### Thursday 13 August        <- day heading, no year
 *   #### **Globex**              <- client group
 *   > [!note] Intention: ...      <- callout, ignored
 *   - [ ] a task                  <- task, may continue on indented lines
 *   ## Initiatives                <- ends the Focus section
 *
 * Only `## Focus` is read. `## Initiatives` and anything after it is a
 * standing index, not dated work, so it never reaches a view.
 */

import type { ClientGroup, Day, Task } from "./types.ts";

const MONTHS = [
  "january",
  "february",
  "march",
  "april",
  "may",
  "june",
  "july",
  "august",
  "september",
  "october",
  "november",
  "december",
];

const WEEKDAYS = [
  "sunday",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
];

/** Turns dashboard markdown into days, client groups and tasks. */
export class Dashboard {
  /**
   * Find the day whose heading resolves to a given date.
   *
   * @param days - Parsed days.
   * @param date - The date to look for.
   * @returns The matching day, or undefined when the dashboard has no heading
   * for it — a normal state, not an error.
   */
  static dayOn(days: Day[], date: Date): Day | undefined {
    const wanted = Dashboard.startOfDay(date).getTime();
    return days.find((d) => d.date !== null && d.date.getTime() === wanted);
  }

  /**
   * Keep only the client groups a repository cares about.
   *
   * Groups are copied rather than mutated when completed tasks are dropped, so
   * toggling the view never edits the parse result — the next toggle back has
   * the full set to work from.
   *
   * @param day - A parsed day, or undefined.
   * @param clients - Client names to keep. An empty list keeps every group.
   * @param showCompleted - Whether to keep `- [x]` tasks.
   * @returns Matching groups that still have at least one task.
   */
  static filterGroups(
    day: Day | undefined,
    clients: readonly string[],
    showCompleted = true,
  ): ClientGroup[] {
    if (!day) return [];
    const wanted = clients.map((c) => c.trim().toLowerCase()).filter(Boolean);
    return day.groups
      .filter(
        (g) => wanted.length === 0 || wanted.includes(g.client.toLowerCase()),
      )
      .map((g) => ({
        ...g,
        tasks: showCompleted ? g.tasks : g.tasks.filter((t) => !t.done),
      }))
      .filter((g) => g.tasks.length > 0);
  }

  /**
   * Parse the `## Focus` section of a dashboard into days and client groups.
   *
   * @param markdown - Full `Dashboard.md` contents.
   * @param today - Reference date used to infer the year on each day heading.
   * @returns Days in document order. Days with no tasks are still returned.
   */
  static parse(markdown: string, today: Date): Day[] {
    const lines = markdown.split(/\r?\n/);
    const days: Day[] = [];

    let inFocus = false;
    let day: Day | undefined;
    let group: ClientGroup | undefined;
    let task: Task | undefined;

    for (const line of lines) {
      const heading = /^(#{2,4})\s+(.*)$/.exec(line);

      if (heading) {
        const level = heading[1]?.length ?? 0;
        const text = (heading[2] ?? "").trim();

        if (level === 2) {
          // `## Focus` opens the section; any other `##` closes it.
          inFocus = /^focus\b/i.test(text);
          day = undefined;
          group = undefined;
          task = undefined;
          continue;
        }
        if (!inFocus) continue;

        if (level === 3) {
          day = {
            date: Dashboard.parseDayHeading(text, today),
            groups: [],
            heading: text,
          };
          days.push(day);
          group = undefined;
          task = undefined;
          continue;
        }

        // level === 4 — a client group. Strip the bold markers around the name.
        if (day) {
          group = { client: text.replace(/\*\*/g, "").trim(), tasks: [] };
          day.groups.push(group);
          task = undefined;
        }
        continue;
      }

      if (!inFocus || !day) continue;

      const checkbox = /^\s*[-*]\s+\[([ xX])\]\s?(.*)$/.exec(line);
      if (checkbox) {
        if (!group) {
          // Tasks written before any `####` heading belong to the day itself.
          group = { client: "", tasks: [] };
          day.groups.push(group);
        }
        task = {
          done: (checkbox[1] ?? " ").toLowerCase() === "x",
          text: checkbox[2] ?? "",
        };
        group.tasks.push(task);
        continue;
      }

      // A continuation line: indented, non-blank, not a callout or heading.
      if (task && /^\s{2,}\S/.test(line) && !/^\s*>/.test(line)) {
        task.text += ` ${line.trim()}`;
        continue;
      }

      // Anything else — a blank line, a callout, loose prose — ends the task
      // but leaves the group open, because the next task is the same client's.
      task = undefined;
    }

    return days;
  }

  /**
   * Resolve a day heading to a date.
   *
   * Headings carry no year (`Thursday 13 August`), so the year is inferred: of
   * last year, this year and next year, take the candidate closest to `today`,
   * preferring one whose weekday matches the heading when a weekday is named.
   * A heading with no day and month at all returns null.
   *
   * @param heading - Heading text without the leading `###`.
   * @param today - Reference date; candidates are ranked by distance from it.
   * @returns Local midnight of the resolved date, or null.
   */
  static parseDayHeading(heading: string, today: Date): Date | null {
    const match =
      /^(?:([A-Za-z]+day)\s+)?(\d{1,2})(?:st|nd|rd|th)?\s+([A-Za-z]+)/.exec(
        heading.trim(),
      );
    if (!match) return null;

    const [, weekdayName, dayText, monthName] = match;
    if (!dayText || !monthName) return null;

    const month = MONTHS.indexOf(monthName.toLowerCase());
    if (month < 0) return null;

    const dayOfMonth = Number(dayText);
    const wantedWeekday = weekdayName
      ? WEEKDAYS.indexOf(weekdayName.toLowerCase())
      : -1;

    const reference = Dashboard.startOfDay(today);
    const candidates: Date[] = [];
    for (const year of [
      reference.getFullYear() - 1,
      reference.getFullYear(),
      reference.getFullYear() + 1,
    ]) {
      const candidate = new Date(year, month, dayOfMonth);
      // Reject a rolled-over date, e.g. 31 February landing on 2 March.
      if (
        candidate.getMonth() === month &&
        candidate.getDate() === dayOfMonth
      ) {
        candidates.push(candidate);
      }
    }
    if (candidates.length === 0) return null;

    const distance = (d: Date) => Math.abs(d.getTime() - reference.getTime());
    const weekdayMatches = candidates.filter(
      (d) => wantedWeekday >= 0 && d.getDay() === wantedWeekday,
    );
    const pool = weekdayMatches.length > 0 ? weekdayMatches : candidates;

    return pool.reduce((best, d) => (distance(d) < distance(best) ? d : best));
  }

  /**
   * Return local midnight for a date, so two dates compare on the day alone.
   *
   * @param date - Any date.
   * @returns A new date at 00:00 local time.
   */
  static startOfDay(date: Date): Date {
    return new Date(date.getFullYear(), date.getMonth(), date.getDate());
  }
}
