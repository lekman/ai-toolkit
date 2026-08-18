/**
 * Build the rag-core bins with Bun, targeting Node.
 *
 * Unlike the shared single-entry build script, this package ships two bins
 * (rag-indexer, rag-mcp, rag-server). LanceDB is a native module and cannot be bundled;
 * it stays a runtime dependency, so `packages: "external"` keeps every
 * dependency out of the bundle and npm installs them instead.
 */

import { chmodSync } from "node:fs";
import { rm } from "node:fs/promises";
import { join } from "node:path";

const root = process.cwd();
const outdir = join(root, "dist");

await rm(outdir, { recursive: true, force: true });

const result = await Bun.build({
  entrypoints: [
    join(root, "src/index.ts"),
    join(root, "src/bin/rag-indexer.ts"),
    join(root, "src/bin/rag-mcp.ts"),
    join(root, "src/bin/rag-server.ts"),
  ],
  outdir,
  target: "node",
  format: "esm",
  packages: "external",
});

if (!result.success) {
  for (const log of result.logs) console.error(log);
  process.exit(1);
}

for (const bin of [
  "bin/rag-indexer.js",
  "bin/rag-mcp.js",
  "bin/rag-server.js",
]) {
  chmodSync(join(outdir, bin), 0o755);
}
console.log(
  "built dist/index.js, dist/bin/rag-indexer.js, dist/bin/rag-mcp.js, dist/bin/rag-server.js",
);
