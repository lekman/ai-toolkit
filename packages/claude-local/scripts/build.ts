/**
 * Build the CLI with Bun, targeting Node.
 *
 * Prompt libraries are bundled into the output rather than declared as runtime
 * dependencies. The published package therefore installs nothing, so a cold
 * `npx @lekman/claude-local` starts in about a second and works on any machine
 * with Node 20 — Bun is a build-time tool here, not a requirement for users.
 */

import { chmodSync } from "node:fs";
import { rm } from "node:fs/promises";
import { join } from "node:path";

const root = join(import.meta.dir, "..");
const outdir = join(root, "dist");

await rm(outdir, { recursive: true, force: true });

const result = await Bun.build({
  entrypoints: [join(root, "src/cli.ts")],
  outdir,
  target: "node",
  format: "esm",
  packages: "bundle",
  // No banner: Bun carries the entrypoint's own shebang through to the bundle,
  // and adding one produces a second, syntactically invalid line.
});

if (!result.success) {
  for (const log of result.logs) console.error(log);
  process.exit(1);
}

for (const output of result.outputs) {
  if (output.path.endsWith(".js")) chmodSync(output.path, 0o755);
  console.log(`built ${output.path.replace(`${root}/`, "")}`);
}
