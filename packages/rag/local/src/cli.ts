#!/usr/bin/env node
/**
 * `rag` — the local runtime CLI.
 *
 *   rag install [--vault <path>] [--storage <dir>]   set up + IQ (+ scan + OQ --rw when the key exists)
 *   rag iq                                           installation qualification, report to <storage>/qualification/
 *   rag oq [--rw]                                    operational qualification (read-only, or end-to-end with cleanup)
 *   rag scan                                         one full reconcile of the vault into the store
 *   rag watch                                        watch the vault and reconcile on change
 *   rag mcp                                          stdio MCP server (used by Claude Code)
 */

import {
  Exclusions,
  Indexer,
  LanceDbChunkStore,
  McpStdioServer,
  VaultReader,
  VoyageEmbeddings,
  WatchRunner,
} from "@lekman/rag-core";
import { fileURLToPath } from "node:url";

import { Config, ConfigStore, DEFAULT_STORAGE } from "./config";
import { Installer } from "./install";
import { Iq, Oq, QualificationRunner, Report } from "./qualification";

const arg = (name: string): string | undefined => {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
};
const has = (flag: string): boolean => process.argv.includes(flag);

const command = process.argv[2];
const storageDir = arg("storage") ?? DEFAULT_STORAGE;
ConfigStore.loadEnv(storageDir);

const requireConfig = () => {
  const config = ConfigStore.load(storageDir);
  if (!config || Config.validate(config).length > 0) {
    console.error("No valid config — run `rag install` first.");
    process.exit(2);
  }
  return config;
};

const requireEmbeddings = (): VoyageEmbeddings => {
  const key = process.env["VOYAGE_API_KEY"];
  if (!key) {
    console.error(
      `VOYAGE_API_KEY missing — add it to ${storageDir}/env (mode 600).`,
    );
    process.exit(3);
  }
  return new VoyageEmbeddings(key);
};

switch (command) {
  case "install": {
    const vault = arg("vault") ?? Installer.detectVault();
    if (!vault) {
      console.error("Could not detect a vault — pass --vault <path>.");
      process.exit(2);
    }
    const config = await Installer.prepareStorage(vault, storageDir);
    console.log(`storage ready: ${config.storageDir}`);

    const cliPath = fileURLToPath(import.meta.url);
    for (const path of await Installer.installAgents(cliPath, storageDir)) {
      console.log(`launchd agent installed: ${path}`);
    }
    console.log(
      (await Installer.registerMcp(cliPath))
        ? "MCP server registered with Claude Code (user scope)"
        : "MCP registration failed — is the `claude` CLI on PATH?",
    );

    const probes = await QualificationRunner.gatherIqProbes(config, storageDir);
    const iqResults = Iq.evaluate(probes);
    const iqReport = await QualificationRunner.writeReport(
      storageDir,
      "IQ",
      iqResults,
    );
    console.log(
      `IQ ${Report.allPass(iqResults) ? "PASS" : "FAIL"} — ${iqReport}`,
    );

    if (probes.voyageKeyPresent && probes.voyageStatus === 200) {
      const embeddings = requireEmbeddings();
      const reader = new VaultReader(config.vaultPath);
      const store = new LanceDbChunkStore(config.dataDir);
      console.log("first scan starting…");
      const scan = await Indexer.scan(reader, store, embeddings);
      console.log(
        `scan done: ${scan.scannedFiles} files, ${scan.chunkCount} chunks, ${scan.embedded} embedded, ${scan.upsertedFiles} written`,
      );
      const oqResults = [
        ...(await Oq.readOnlyChecks(
          store,
          embeddings,
          "architecture decisions",
          config.freshnessDays,
          Date.now(),
          await QualificationRunner.measureStorageBytes(config.dataDir),
        )),
        ...(await QualificationRunner.readWriteChecks(
          config,
          reader,
          store,
          embeddings,
        )),
      ];
      const oqReport = await QualificationRunner.writeReport(
        storageDir,
        "OQ",
        oqResults,
      );
      console.log(
        `OQ ${Report.allPass(oqResults) ? "PASS" : "FAIL"} — ${oqReport}`,
      );
    } else {
      console.log(
        `Skipping first scan and OQ: add VOYAGE_API_KEY to ${storageDir}/env, then run \`rag iq && rag scan && rag oq --rw\`.`,
      );
    }
    break;
  }

  case "iq": {
    const config = ConfigStore.load(storageDir);
    const results = Iq.evaluate(
      await QualificationRunner.gatherIqProbes(config, storageDir),
    );
    const report = await QualificationRunner.writeReport(
      storageDir,
      "IQ",
      results,
    );
    console.log(`IQ ${Report.allPass(results) ? "PASS" : "FAIL"} — ${report}`);
    process.exit(Report.allPass(results) ? 0 : 1);
    break;
  }

  case "oq": {
    const config = requireConfig();
    const embeddings = requireEmbeddings();
    const store = new LanceDbChunkStore(config.dataDir);
    const results = await Oq.readOnlyChecks(
      store,
      embeddings,
      "architecture decisions",
      config.freshnessDays,
      Date.now(),
      await QualificationRunner.measureStorageBytes(config.dataDir),
    );
    if (has("--rw")) {
      const reader = new VaultReader(config.vaultPath);
      results.push(
        ...(await QualificationRunner.readWriteChecks(
          config,
          reader,
          store,
          embeddings,
        )),
      );
    }
    const report = await QualificationRunner.writeReport(
      storageDir,
      "OQ",
      results,
    );
    console.log(`OQ ${Report.allPass(results) ? "PASS" : "FAIL"} — ${report}`);
    process.exit(Report.allPass(results) ? 0 : 1);
    break;
  }

  case "scan": {
    const config = requireConfig();
    const report = await Indexer.scan(
      new VaultReader(config.vaultPath),
      new LanceDbChunkStore(config.dataDir),
      requireEmbeddings(),
    );
    console.log(JSON.stringify(report, null, 2));
    break;
  }

  case "watch": {
    const config = requireConfig();
    const stop = new WatchRunner(
      (report) => {
        console.log(`[${new Date().toISOString()}] ${JSON.stringify(report)}`);
      },
      3000,
      Exclusions.shouldTriggerScan,
    ).run(
      config.vaultPath,
      new VaultReader(config.vaultPath),
      new LanceDbChunkStore(config.dataDir),
      requireEmbeddings(),
    );
    process.on("SIGINT", () => {
      stop();
      process.exit(0);
    });
    process.on("SIGTERM", () => {
      stop();
      process.exit(0);
    });
    console.log(`watching ${config.vaultPath}`);
    break;
  }

  case "mcp": {
    const config = requireConfig();
    await McpStdioServer.serve(
      new LanceDbChunkStore(config.dataDir),
      requireEmbeddings(),
    );
    break;
  }

  default:
    console.error(
      "usage: rag <install|iq|oq [--rw]|scan|watch|mcp> [--vault <path>] [--storage <dir>]",
    );
    process.exit(2);
}
