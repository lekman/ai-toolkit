/** Value types for the parsed dashboard. */

/** The tasks under one `#### **Client**` heading. */
export interface ClientGroup {
  /** Heading text with its bold markers stripped, e.g. `Acme`. */
  client: string;
  tasks: Task[];
}

/** One `### <day>` heading and everything under it. */
export interface Day {
  /**
   * Local midnight of the heading's date, or null when the heading carries no
   * date — `### Unscheduled — no day assigned` is the case that matters.
   */
  date: Date | null;
  groups: ClientGroup[];
  /** Heading text as written, e.g. `Thursday 13 August`. */
  heading: string;
}

/** One `- [ ]` / `- [x]` entry, with its indented continuation lines joined in. */
export interface Task {
  /** True for `- [x]`. Views render the box disabled either way. */
  done: boolean;
  /** Raw inline markdown, not yet converted to HTML. */
  text: string;
}
