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
  launchdLoaded: { scan: boolean; server: boolean; watch: boolean };
  /** Last exit status per agent; non-zero means it is loaded but failing. */
  launchdExit: {
    scan: null | number;
    server: null | number;
    watch: null | number;
  };
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
        detail: (["scan", "watch", "server"] as const)
          .map((name) => {
            const exit = probes.launchdExit[name];
            return `${name}: ${probes.launchdLoaded[name] ? "loaded" : "NOT loaded"}${
              exit === null || exit === 0 ? "" : ` but exit=${String(exit)}`
            }`;
          })
          .join(", "),
        name: "launchd agents loaded and healthy",
        // Loaded is not working. A KeepAlive agent that crashes on every start
        // stays loaded, so a non-zero last exit has to fail this check —
        // otherwise a Mini whose watcher cannot read the vault reports PASS.
        pass: (["scan", "watch", "server"] as const).every(
          (name) =>
            probes.launchdLoaded[name] && (probes.launchdExit[name] ?? 0) === 0,
        ),
        remediation:
          "check ~/.rag/logs/<agent>.log. EPERM on the vault means the agent " +
          "lacks Full Disk Access: grant it in System Settings > Privacy & " +
          "Security > Full Disk Access, then `rag install` to rebootstrap.",
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
