import type { RagConfig } from "./types";

/**
 * Configuration defaults and validation. Pure — path strings in, verdicts
 * out; reading and writing files is the system layer's job.
 */
export class Config {
  /** Build a config from a vault path and an optional storage root. */
  static build(vaultPath: string, storageDir: string): RagConfig {
    return {
      dataDir: `${storageDir}/data`,
      freshnessDays: 30,
      storageDir,
      vaultPath,
    };
  }

  /** Validate a parsed config object; returns problems, empty when valid. */
  static validate(candidate: unknown): string[] {
    const problems: string[] = [];
    const config = candidate as Partial<RagConfig> | null;
    if (!config || typeof config !== "object")
      return ["config is not an object"];
    for (const key of ["dataDir", "storageDir", "vaultPath"] as const) {
      const value = config[key];
      if (typeof value !== "string" || value.length === 0)
        problems.push(`${key} missing or empty`);
      else if (!value.startsWith("/"))
        problems.push(`${key} must be an absolute path`);
    }
    if (typeof config.freshnessDays !== "number" || config.freshnessDays <= 0)
      problems.push("freshnessDays must be a positive number");
    return problems;
  }
}
