import { constants } from "node:os";

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
  /**
   * Last raw wait status per agent, as launchd's `LastExitStatus` reports it:
   * a real exit code sits in the high byte (exit 1 reads as 256) and a signal
   * death in the low bits (a SIGTERM from `launchctl kickstart -k` reads as
   * 15). Decode with {@link decodeWaitStatus} before judging it.
   */
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

/** A launchd `LastExitStatus`, decoded from its raw wait(2) encoding. */
export type WaitStatus =
  | { kind: "clean" }
  | { kind: "exit"; code: number }
  | { kind: "signal"; name: string; signal: number }
  | { kind: "unknown" };

const SIGNAL_NAMES: Record<number, string> = Object.fromEntries(
  Object.entries(constants.signals).map(([name, num]) => [num, name]),
);

/**
 * Decode launchd's `LastExitStatus`, which is a raw wait(2) status: a normal
 * exit stores its code in the high byte (exit 1 → 256), a signal death stores
 * the signal number in the low seven bits (SIGTERM → 15, plus 0x80 when it
 * dumped core). Reading the raw number as an exit code is the bug this
 * decoder exists to fix — a deliberate `launchctl kickstart -k` restart read
 * as a crash.
 */
export function decodeWaitStatus(raw: number | null): WaitStatus {
  if (raw === null) {
    return { kind: "unknown" };
  }
  if (raw === 0) {
    return { kind: "clean" };
  }
  const signal = raw & 0x7f;
  if (raw > 0 && signal !== 0) {
    return {
      kind: "signal",
      name: SIGNAL_NAMES[signal] ?? `signal ${String(signal)}`,
      signal,
    };
  }
  return { code: (raw >> 8) & 0xff, kind: "exit" };
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
            if (!probes.launchdLoaded[name]) {
              return `${name}: NOT loaded`;
            }
            const status = decodeWaitStatus(probes.launchdExit[name]);
            switch (status.kind) {
              case "exit":
                return `${name}: loaded but exit code ${String(status.code)}`;
              case "signal":
                return `${name}: loaded, last stopped by ${status.name} (a restart, not a crash)`;
              default:
                return `${name}: loaded`;
            }
          })
          .join(", "),
        name: "launchd agents loaded and healthy",
        // Loaded is not working. A KeepAlive agent that crashes on every start
        // stays loaded, so a real non-zero exit code has to fail this check —
        // otherwise a Mini whose watcher cannot read the vault reports PASS.
        // A signal death is different: launchd cannot say who sent the signal,
        // KeepAlive relaunches the agent either way, and failing on it made
        // every deliberate `launchctl kickstart -k` restart flip IQ to FAIL.
        // Signals therefore pass, named in the detail so a crash-looping
        // agent is still visible in the evidence.
        pass: (["scan", "watch", "server"] as const).every(
          (name) =>
            probes.launchdLoaded[name] &&
            decodeWaitStatus(probes.launchdExit[name]).kind !== "exit",
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
