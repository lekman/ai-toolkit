/** Value types for the view domain. */

import type { ClientGroup } from "../dashboard/types.ts";

/** Everything one pane needs to render itself. */
export interface PaneModel {
  /** Client groups to list, already filtered. */
  groups: ClientGroup[];
  /** The dashboard's heading for this day, e.g. `Thursday 13 August`. */
  heading: null | string;
  /** Message to show instead of tasks — no dashboard, no heading, no tasks. */
  message: null | string;
  /** Whether to print each client's name above its tasks. */
  showClientHeadings: boolean;
  /**
   * Absolute vault path, so a `[Details](Clients/…)` target can be resolved
   * to a file the markdown preview can open. Undefined when unconfigured, in
   * which case those links stay plain text.
   */
  vaultRoot?: string;
}
