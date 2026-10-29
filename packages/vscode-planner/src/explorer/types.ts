/** Value types for the hidden-files toggle. */

/**
 * `files.exclude` as VS Code stores it: a glob to `true`, `false`, or a
 * `{ "when": … }` condition. Only `true` and `false` are toggled; a condition
 * is left as it is.
 */
export type ExcludeMap = Record<string, unknown>;

/** The result of one toggle. */
export interface ExcludeToggle {
  /** The map to write back to the user settings. */
  exclude: ExcludeMap;
  /** Whether files are hidden after the toggle. */
  hidden: boolean;
  /** The patterns to set back to `true` on the next toggle. */
  remembered: string[];
}
