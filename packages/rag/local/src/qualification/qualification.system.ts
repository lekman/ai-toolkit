import type {
  IChunkStore,
  IEmbeddingsProvider,
  ISourceReader,
} from "@lekman/rag-core";

import { Indexer, SearchHandlers } from "@lekman/rag-core";
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { accessSync, constants, existsSync, readFileSync } from "node:fs";
import { mkdir, unlink, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import type { CheckResult, RagConfig } from "../config";
import type { ClaudeMcpState, IqProbes } from "./iq";
import type { ReportKind } from "./types";

import { Config, ConfigStore } from "../config";
import { LaunchdInstaller } from "../launchd";
import { Oq, OQ_FIXTURE_DIR } from "./oq";
import { Report } from "./report";

const exec = promisify(execFile);

/**
 * Where `claude` is installed, beyond whatever PATH happens to carry.
 *
 * The probe used to trust PATH. Over non-interactive SSH and from launchd it
 * does not include the user-local bin directory, so the exec failed and the
 * check reported the server unregistered on a machine where it was registered
 * and connected.
 */
const CLAUDE_BINARIES = [
  "claude",
  join(homedir(), ".local/bin/claude"),
  "/opt/homebrew/bin/claude",
  "/usr/local/bin/claude",
];

/** Where `claude mcp add --scope user` records the server. */
const CLAUDE_USER_CONFIG = join(homedir(), ".claude.json");

/** Gathers IQ probes and drives the OQ flows. Thin wrappers — logic in Iq/Oq. */
export class QualificationRunner {
  /** Bytes on disk under the store's data directory; 0 when unmeasurable. */
  static async measureStorageBytes(dataDir: string): Promise<number> {
    if (!existsSync(dataDir)) return 0;
    try {
      const { stdout } = await exec("du", ["-sk", dataDir]);
      const kib = Number.parseInt(stdout.trim().split(/\s+/)[0] ?? "", 10);
      return Number.isNaN(kib) ? 0 : kib * 1024;
    } catch {
      return 0;
    }
  }

  /**
   * How far the local stdio MCP registration can be verified here.
   *
   * Running the CLI is the stronger evidence — it reports the server actually
   * connected, not merely present in a file — so it stays the primary path.
   * Reading the config is the degraded fallback for when no `claude` can be
   * found, and it reports `configured` rather than a pass or a failure,
   * because a config entry proves registration and not connectivity.
   *
   * The lookup paths are parameters so a test can drive every branch; the
   * defaults are what production uses.
   */
  static async probeClaudeMcp(
    binaries: readonly string[] = CLAUDE_BINARIES,
    configPath: string = CLAUDE_USER_CONFIG,
  ): Promise<ClaudeMcpState> {
    for (const binary of binaries) {
      const ran = await exec(binary, ["mcp", "get", "rag"]).then(
        () => "connected" as const,
        (error: NodeJS.ErrnoException) =>
          // ENOENT is "no such binary" — keep looking. Any other failure means
          // the CLI ran and rejected, which is a real answer about rag.
          error.code === "ENOENT" ? null : ("absent" as const),
      );
      if (ran) return ran;
    }
    try {
      const raw: unknown = JSON.parse(readFileSync(configPath, "utf8"));
      const servers = (raw as { mcpServers?: Record<string, unknown> })
        .mcpServers;
      if (!servers) return "unknown";
      return "rag" in servers ? "configured" : "absent";
    } catch {
      return "unknown";
    }
  }

  /** Gather every IQ probe from the installed system. */
  static async gatherIqProbes(
    config: RagConfig | null,
    storageDir: string,
  ): Promise<IqProbes> {
    ConfigStore.loadEnv(storageDir);
    const apiKey = process.env["VOYAGE_API_KEY"];

    let voyageStatus: number | null = null;
    if (apiKey) {
      try {
        const response = await fetch("https://api.voyageai.com/v1/embeddings", {
          body: JSON.stringify({ input: ["ping"], model: "voyage-3.5" }),
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
          },
          method: "POST",
        });
        voyageStatus = response.status;
      } catch {
        voyageStatus = null;
      }
    }

    const writable = (path: string): boolean => {
      try {
        accessSync(path, constants.W_OK);
        return true;
      } catch {
        return false;
      }
    };
    const readable = (path: string): boolean => {
      try {
        accessSync(path, constants.R_OK);
        return true;
      } catch {
        return false;
      }
    };

    return {
      claudeMcp: await QualificationRunner.probeClaudeMcp(),
      configProblems: config
        ? Config.validate(config)
        : ["config.json not found"],
      launchdExit: {
        scan: await LaunchdInstaller.lastExitStatus("com.lekman.rag.scan"),
        server: await LaunchdInstaller.lastExitStatus("com.lekman.rag.server"),
        watch: await LaunchdInstaller.lastExitStatus("com.lekman.rag.watch"),
      },
      launchdLoaded: {
        scan: await LaunchdInstaller.isLoaded("com.lekman.rag.scan"),
        server: await LaunchdInstaller.isLoaded("com.lekman.rag.server"),
        watch: await LaunchdInstaller.isLoaded("com.lekman.rag.watch"),
      },
      nodeMajor: Number(process.versions.node.split(".")[0]),
      storageWritable: existsSync(storageDir) && writable(storageDir),
      vaultReadable:
        config !== null &&
        existsSync(config.vaultPath) &&
        readable(config.vaultPath),
      voyageKeyPresent: apiKey !== undefined && apiKey.length > 0,
      voyageStatus,
    };
  }

  /**
   * OQ read-write flow: write a sentinel fixture into the vault, scan,
   * verify retrieval, remove it, scan again, verify removal. The fixture is
   * deleted in a finally block so it cannot outlive the run.
   */
  static async readWriteChecks(
    config: RagConfig,
    reader: ISourceReader,
    store: IChunkStore,
    embeddings: IEmbeddingsProvider,
  ): Promise<CheckResult[]> {
    const sentinel = randomUUID();
    const fixture = Oq.fixture(sentinel);
    const absPath = join(config.vaultPath, fixture.relPath);
    const results: CheckResult[] = [];

    try {
      await mkdir(join(config.vaultPath, OQ_FIXTURE_DIR), { recursive: true });
      await writeFile(absPath, fixture.content);
      await Indexer.scan(reader, store, embeddings);

      const found = await SearchHandlers.search(
        store,
        embeddings,
        `sentinel ${sentinel}`,
        {},
        5,
      );
      const hit = found.some((result) => result.chunk.text.includes(sentinel));
      results.push({
        detail: hit
          ? "sentinel ingested and retrieved"
          : "sentinel not found after scan",
        name: "read-write: ingest → embed → store → retrieve",
        pass: hit,
        remediation: "check watcher/scan logs and VOYAGE_API_KEY",
      });
    } finally {
      await unlink(absPath).catch(() => undefined);
    }

    await Indexer.scan(reader, store, embeddings);
    const after = await SearchHandlers.search(
      store,
      embeddings,
      `sentinel ${sentinel}`,
      {},
      5,
    );
    const lingering = after.some((result) =>
      result.chunk.text.includes(sentinel),
    );
    results.push({
      detail: lingering
        ? "sentinel chunks still present after delete"
        : "sentinel fully removed after delete",
      name: "read-write: deletion reconciles (cleanup proven)",
      pass: !lingering,
      remediation: "check deleteByPath and the reconcile step",
    });

    return results;
  }

  /** Write a qualification report and return its path. */
  static async writeReport(
    storageDir: string,
    kind: ReportKind,
    results: CheckResult[],
  ): Promise<string> {
    const timestamp = new Date().toISOString();
    const path = join(
      storageDir,
      "qualification",
      `${kind}-${timestamp.replaceAll(":", "-")}.md`,
    );
    await writeFile(
      path,
      Report.render(`${kind} — RAG local runtime`, results, timestamp),
    );
    return path;
  }
}
