import type { CheckResult } from "../config";

/** Probe outcomes gathered by the system layer, evaluated by Iq. */
export interface IqProbes {
  /** Whether `claude mcp get rag` succeeded. */
  claudeMcpRegistered: boolean;
  /** Config validation problems (empty when valid). */
  configProblems: string[];
  /** Whether the storage dir exists and is writable. */
  storageWritable: boolean;
  /** Node.js major version. */
  nodeMajor: number;
  /** Whether the scan and watch launchd labels are loaded. */
  launchdLoaded: { scan: boolean; watch: boolean };
  /** Whether the vault path exists and is readable. */
  vaultReadable: boolean;
  /** HTTP status of a one-token Voyage probe, or null when unreachable. */
  voyageStatus: number | null;
  /** Whether VOYAGE_API_KEY was present after sourcing <storage>/env. */
  voyageKeyPresent: boolean;
}

/**
 * Installation qualification: turns probe results into check verdicts.
 * Pure — the system runner gathers probes, this class judges them.
 */
export class Iq {
  /** Evaluate all IQ checks from gathered probes. */
  static evaluate(probes: IqProbes): CheckResult[] {
    return [
      {
        detail: `node major ${probes.nodeMajor}`,
        name: "runtime version",
        pass: probes.nodeMajor >= 20,
        remediation: "install Node 20 or later",
      },
      {
        detail:
          probes.configProblems.length === 0
            ? "config valid"
            : probes.configProblems.join("; "),
        name: "config exists and validates",
        pass: probes.configProblems.length === 0,
        remediation: "run `rag install` to (re)write the config",
      },
      {
        detail: probes.storageWritable
          ? "storage dir writable"
          : "storage dir missing or read-only",
        name: "storage directory",
        pass: probes.storageWritable,
        remediation: "run `rag install`, or fix permissions on the storage dir",
      },
      {
        detail: probes.vaultReadable
          ? "vault readable"
          : "vault path missing or unreadable",
        name: "source vault",
        pass: probes.vaultReadable,
        remediation: "check vaultPath in config.json",
      },
      {
        detail: probes.voyageKeyPresent
          ? "VOYAGE_API_KEY present"
          : "VOYAGE_API_KEY missing",
        name: "embedding credential",
        pass: probes.voyageKeyPresent,
        remediation: "add VOYAGE_API_KEY=... to <storage>/env (mode 600)",
      },
      {
        detail:
          probes.voyageStatus === 200
            ? "Voyage responded 200"
            : `Voyage probe: ${probes.voyageStatus ?? "unreachable"}`,
        name: "embedding endpoint reachable",
        pass: probes.voyageStatus === 200,
        remediation: "check network and the API key at the Voyage console",
      },
      {
        detail: `scan loaded: ${probes.launchdLoaded.scan}, watch loaded: ${probes.launchdLoaded.watch}`,
        name: "launchd agents loaded",
        pass: probes.launchdLoaded.scan && probes.launchdLoaded.watch,
        remediation: "run `rag install` to (re)bootstrap the agents",
      },
      {
        detail: probes.claudeMcpRegistered
          ? "claude mcp: rag registered"
          : "rag not registered",
        name: "MCP registration",
        pass: probes.claudeMcpRegistered,
        remediation:
          "run `rag install`, or `claude mcp add --scope user rag -- rag mcp`",
      },
    ];
  }
}
