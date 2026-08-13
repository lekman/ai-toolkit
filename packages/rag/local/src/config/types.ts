/** The local runtime's configuration, stored at <storage>/config.json. */
export interface RagConfig {
  /** Absolute path to the local store's data directory. */
  dataDir: string;
  /** Days after which OQ flags the newest indexed note as stale. */
  freshnessDays: number;
  /** Absolute path to the storage root (config, env, data, qualification). */
  storageDir: string;
  /** Absolute path to the Obsidian vault to index. */
  vaultPath: string;
}

/** One qualification check outcome. */
export interface CheckResult {
  /** What was observed, or why the check failed. */
  detail: string;
  /** Check name as it appears in the report. */
  name: string;
  /** Whether the check passed. */
  pass: boolean;
  /** How to fix a failure; empty when passing. */
  remediation: string;
}
