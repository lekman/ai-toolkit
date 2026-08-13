/**
 * Build the extension with Bun, targeting Node.
 *
 * VS Code loads an extension host module as CommonJS and provides the `vscode`
 * module itself, so it stays external. Everything else is bundled, which is
 * what lets the VSIX ship with `--no-dependencies`.
 */

import { rm } from "node:fs/promises";
import { join } from "node:path";

const root = process.cwd();
const outdir = join(root, "dist");

await rm(outdir, { recursive: true, force: true });

const result = await Bun.build({
  entrypoints: [join(root, "src/extension.ts")],
  external: ["vscode"],
  format: "cjs",
  outdir,
  target: "node",
});

if (!result.success) {
  for (const log of result.logs) console.error(log);
  process.exit(1);
}

console.log("built dist/extension.js");
