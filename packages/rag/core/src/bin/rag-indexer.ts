#!/usr/bin/env node
/**
 * Ingestion CLI: `rag-indexer scan|watch --vault <path> --data <dir>`.
 * Environment: VOYAGE_API_KEY (required for real embedding).
 */

import { VoyageEmbeddings } from "../embeddings";
import { Indexer, WatchRunner } from "../indexer";
import { Exclusions, VaultReader } from "../obsidian";
import { LanceDbChunkStore } from "../store";

const arg = (name: string): string | undefined => {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
};

const mode = process.argv[2];
const vault = arg("vault") ?? process.env["RAG_VAULT"];
const data = arg("data") ?? process.env["RAG_DATA"];
const apiKey = process.env["VOYAGE_API_KEY"];

if ((mode !== "scan" && mode !== "watch") || !vault || !data) {
  console.error("usage: rag-indexer <scan|watch> --vault <path> --data <dir>");
  process.exit(2);
}
if (!apiKey) {
  console.error(
    "VOYAGE_API_KEY is not set — cannot embed. See the install guide.",
  );
  process.exit(3);
}

const reader = new VaultReader(vault);
const store = new LanceDbChunkStore(data);
const embeddings = new VoyageEmbeddings(apiKey);

if (mode === "scan") {
  const report = await Indexer.scan(reader, store, embeddings);
  console.log(JSON.stringify(report, null, 2));
} else {
  const stop = new WatchRunner(
    (report) => {
      console.log(
        `[${new Date().toISOString()}] scan: ${JSON.stringify(report)}`,
      );
    },
    3000,
    Exclusions.shouldTriggerScan,
  ).run(vault, reader, store, embeddings);
  process.on("SIGINT", () => {
    stop();
    process.exit(0);
  });
  process.on("SIGTERM", () => {
    stop();
    process.exit(0);
  });
  console.log(`watching ${vault} → ${data}`);
}
