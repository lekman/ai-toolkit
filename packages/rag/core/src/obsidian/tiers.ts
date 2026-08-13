import type { TierName } from "../model";

/**
 * Maps a vault-relative path to its trust tier. Top-level folder decides:
 * Personal/ is private; everything else in this vault is private-business.
 * The shared-business tier arrives with phase-3 sources, not this vault.
 */
export class TierMap {
  /** Derive the tier for an eligible (non-excluded) vault path. */
  static derive(relPath: string): TierName {
    return relPath.split("/")[0] === "Personal"
      ? "private"
      : "private-business";
  }
}
