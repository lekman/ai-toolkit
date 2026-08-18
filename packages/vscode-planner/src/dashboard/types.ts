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
  /** True for `- [x]`. */
  done: boolean;
  /**
   * Zero-based index of the `- [ ]` line in the source markdown.
   *
   * This is what a click in the pane is resolved against. It is a hint, not a
   * handle: the file is written by Obsidian, by iCloud sync and by other
   * agents, so the line may be something else by the time a click arrives.
   * Every write re-reads the file and checks the line still looks the way it
   * did before touching it.
   */
  line: number;
  /** Raw inline markdown, not yet converted to HTML. */
  text: string;
}
