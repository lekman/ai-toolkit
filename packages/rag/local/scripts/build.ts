/**
 * Build the `rag` CLI with Bun, targeting Node. Dependencies stay external:
 * rag-core carries the LanceDB native module, which cannot be bundled.
 */

import { chmodSync } from "node:fs";
import { rm } from "node:fs/promises";
import { join } from "node:path";

const root = process.cwd();
const outdir = join(root, "dist");

await rm(outdir, { recursive: true, force: true });

const result = await Bun.build({
  entrypoints: [join(root, "src/cli.ts")],
  outdir,
  target: "node",
  format: "esm",
  packages: "external",
});

if (!result.success) {
  for (const log of result.logs) console.error(log);
  process.exit(1);
}

chmodSync(join(outdir, "cli.js"), 0o755);
console.log("built dist/cli.js");
