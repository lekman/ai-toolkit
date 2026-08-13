/** Parsed frontmatter attributes plus the remaining markdown body. */
export interface ParsedNote {
  /** Flat string attributes; list values are joined with ", ". */
  attrs: Record<string, string>;
  /** Markdown body with the frontmatter block removed. */
  body: string;
}

/** Why a path was excluded from indexing. */
export type ExclusionReason =
  | "backup"
  | "conflict-copy"
  | "health-deferred"
  | "system"
  | "templates"
  | "volatile";
