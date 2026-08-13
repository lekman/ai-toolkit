import { watch } from "node:fs";
import { basename } from "node:path";

import type { IEmbeddingsProvider } from "../embeddings";
import type { ISourceReader } from "../obsidian";
import type { IChunkStore } from "../store";
import type { ScanReport } from "./types";

import { Indexer } from "./indexer";

/**
 * Watch mode: debounced full-scan reconcile on filesystem change bursts.
 * Thin wrapper over fs.watch — the reconcile logic lives in Indexer.
 */
export class WatchRunner {
  private readonly debounceMs: number;
  private readonly onScan: (report: ScanReport) => void;
  private readonly shouldScan: (filename: string | null) => boolean;
  private timer: ReturnType<typeof setTimeout> | undefined;

  constructor(
    onScan: (report: ScanReport) => void,
    debounceMs = 3000,
    shouldScan: (filename: string | null) => boolean = () => true,
  ) {
    this.debounceMs = debounceMs;
    this.onScan = onScan;
    this.shouldScan = shouldScan;
  }

  /** Watch the source root; returns a stop function. */
  run(
    root: string,
    reader: ISourceReader,
    store: IChunkStore,
    embeddings: IEmbeddingsProvider,
  ): () => void {
    const trigger = () => {
      clearTimeout(this.timer);
      this.timer = setTimeout(() => {
        void Indexer.scan(reader, store, embeddings).then(this.onScan);
      }, this.debounceMs);
    };
    const rootName = basename(root);
    const watcher = watch(root, { recursive: true }, (_event, filename) => {
      // Events on excluded files (Dashboard.md, .obsidian churn) would only
      // produce a guaranteed no-op reconcile — drop them at the door. An
      // event named after the root itself is normalised to "" so the
      // predicate can treat root-metadata churn distinctly.
      const name = filename === null ? null : String(filename);
      if (!this.shouldScan(name === rootName ? "" : name)) return;
      trigger();
    });
    trigger(); // initial reconcile on start
    return () => {
      clearTimeout(this.timer);
      watcher.close();
    };
  }
}
