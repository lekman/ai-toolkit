/**
 * Showing and hiding the files listed in the user's `files.exclude`.
 *
 * The list stays in the user settings, so other extensions that read it keep
 * working. Showing the files sets each hiding pattern to `false` and
 * remembers which ones were hiding; hiding them again sets exactly those back
 * to `true`, so a pattern the user had switched off stays off.
 */

import type { ExcludeMap, ExcludeToggle } from "./types.ts";

/** Pure logic behind the hidden-files toggle. */
export class Explorer {
  /**
   * Whether any pattern is hiding files now.
   *
   * @param exclude - The user's `files.exclude`.
   * @returns True when at least one pattern is `true`.
   */
  static hiding(exclude: ExcludeMap): boolean {
    return Object.values(exclude).some((value) => value === true);
  }

  /**
   * Flip between hiding and showing the excluded files.
   *
   * @param exclude - The user's `files.exclude`.
   * @param remembered - The patterns that were hiding before the last show.
   * @returns The new map, the patterns to remember, and whether files are now hidden.
   */
  static toggle(exclude: ExcludeMap, remembered: string[]): ExcludeToggle {
    if (Explorer.hiding(exclude)) {
      const hidingKeys = Object.keys(exclude).filter(
        (k) => exclude[k] === true,
      );
      const next = { ...exclude };
      for (const key of hidingKeys) next[key] = false;
      return { exclude: next, hidden: false, remembered: hidingKeys };
    }

    // With nothing remembered, for example after the list was edited by
    // hand, every `false` pattern is taken as one to hide.
    const known = remembered.filter((key) => key in exclude);
    const restore =
      known.length > 0
        ? known
        : Object.keys(exclude).filter((k) => exclude[k] === false);
    const next = { ...exclude };
    for (const key of restore) next[key] = true;
    return { exclude: next, hidden: restore.length > 0, remembered: [] };
  }
}
