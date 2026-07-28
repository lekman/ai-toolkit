/**
 * Maintainer release script: build, assemble, verify, publish.
 *
 * Authentication is browser-based (`npm login`), so no token is ever written
 * into the repo or the environment. npm revoked classic tokens in early 2026
 * and write-enabled granular tokens now expire in days, which makes a
 * long-lived local token both unavailable and a bad idea.
 *
 *   bun run release              # publish the current version to latest
 *   bun run release --dry-run    # do everything except the publish call
 *   bun run release --tag next   # publish under a different dist-tag
 *   bun run release --otp 123456 # pass a 2FA code non-interactively
 *
 * Publishing from CI instead? Use npm trusted publishing (OIDC) rather than a
 * secret — it needs no token at all and attaches provenance automatically.
 * Provenance is not available from a laptop, so this script does not ask for it.
 */

import { spawn, spawnSync } from "node:child_process";
import { copyFileSync, existsSync, readFileSync, statSync } from "node:fs";
import { createInterface } from "node:readline/promises";
import { join } from "node:path";

const root = join(import.meta.dir, "..");
const repoRoot = join(root, "..", "..");

interface Options {
  dryRun: boolean;
  distTag: string;
  otp?: string;
}

function parseArgs(argv: string[]): Options {
  const opts: Options = { dryRun: false, distTag: "latest" };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--dry-run") opts.dryRun = true;
    else if (arg === "--tag") opts.distTag = argv[++i] ?? "latest";
    else if (arg === "--otp") opts.otp = argv[++i];
    else fail(`Unknown argument: ${arg}`);
  }
  return opts;
}

const step = (msg: string) => console.log(`\x1b[34m==>\x1b[0m ${msg}`);
const warn = (msg: string) => console.warn(`\x1b[33mwarn:\x1b[0m ${msg}`);

function fail(msg: string): never {
  console.error(`\x1b[31merror:\x1b[0m ${msg}`);
  process.exit(1);
}

function capture(cmd: string, args: string[], cwd = root) {
  const r = spawnSync(cmd, args, { encoding: "utf8", cwd });
  return {
    code: r.status ?? 1,
    out: (r.stdout ?? "").trim(),
    err: (r.stderr ?? "").trim(),
  };
}

function stream(cmd: string, args: string[], cwd = root): Promise<number> {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { stdio: "inherit", cwd });
    child.on("close", (code) => resolve(code ?? 1));
    child.on("error", () => resolve(1));
  });
}

async function ask(question: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = await rl.question(question);
  rl.close();
  return answer.trim().toLowerCase();
}

/**
 * Find a working npm. The usual failure here is a version manager whose `npm`
 * shim resolves to nothing because no global runtime is pinned, so fall back to
 * running npm through mise before giving up.
 */
function resolveRuntime(): { npm: string[]; node: string[] } {
  if (capture("npm", ["--version"]).code === 0)
    return { npm: ["npm"], node: ["node"] };
  const versions = capture("mise", ["ls", "--installed", "node"]).out;
  const version = versions.split("\n").at(-1)?.trim().split(/\s+/)[1];
  if (
    version &&
    capture("mise", ["exec", `node@${version}`, "--", "npm", "--version"])
      .code === 0
  ) {
    warn(`No global node on PATH. Using mise exec node@${version}.`);
    const prefix = ["mise", "exec", `node@${version}`, "--"];
    return { npm: [...prefix, "npm"], node: [...prefix, "node"] };
  }
  return fail(
    "npm not found. Pin a global Node (for example: mise use -g node@22) and retry.",
  );
}

async function main(): Promise<void> {
  const opts = parseArgs(process.argv.slice(2));
  const { npm, node } = resolveRuntime();
  const npmRun = (args: string[]) =>
    capture(npm[0]!, [...npm.slice(1), ...args]);
  const npmStream = (args: string[]) =>
    stream(npm[0]!, [...npm.slice(1), ...args]);
  const nodeRun = (args: string[]) =>
    capture(node[0]!, [...node.slice(1), ...args]);

  const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as {
    name: string;
    version: string;
  };
  const id = `${pkg.name}@${pkg.version}`;

  // --- 1. Preflight ---------------------------------------------------------

  step("Checking the working tree");
  const dirty = capture(
    "git",
    ["status", "--porcelain", "--", root],
    repoRoot,
  ).out;
  if (dirty) {
    fail(
      `Uncommitted changes under ${pkg.name}. Publish only what is committed:\n${dirty}`,
    );
  }

  const branch = capture(
    "git",
    ["rev-parse", "--abbrev-ref", "HEAD"],
    repoRoot,
  ).out;
  if (branch !== "main") {
    warn(`On branch "${branch}", not main.`);
    if ((await ask("Continue anyway? [y/N] ")) !== "y") fail("Stopped.");
  }

  step(`Checking whether ${id} is already published`);
  const published = npmRun(["view", pkg.name, "versions", "--json"]);
  if (published.code === 0) {
    const versions = JSON.parse(published.out) as string[] | string;
    const list = Array.isArray(versions) ? versions : [versions];
    if (list.includes(pkg.version)) {
      fail(
        `${id} is already on the registry. Bump the version in package.json first.`,
      );
    }
  } else {
    step("Not on the registry yet — this will be the first publish.");
  }

  // --- 2. Build -------------------------------------------------------------

  step("Typecheck and build");
  if ((await stream("bun", ["run", "check"])) !== 0) fail("Build failed.");

  // --- 3. Assemble the published files --------------------------------------

  step("Assembling package files");
  // npm includes a LICENSE next to package.json automatically. The repo keeps
  // one canonical copy at the root, so mirror it in rather than duplicating it
  // in version control.
  copyFileSync(join(repoRoot, "LICENSE"), join(root, "LICENSE"));

  for (const bin of ["dist/cli.js"]) {
    const path = join(root, bin);
    if (!existsSync(path)) fail(`Missing build output: ${bin}`);
    if (!readFileSync(path, "utf8").startsWith("#!/usr/bin/env node")) {
      fail(`${bin} lost its shebang — it would not run as a CLI.`);
    }
    if (!(statSync(path).mode & 0o111)) fail(`${bin} is not executable.`);
  }

  // The artifact must run under plain Node, not just under Bun. This is the
  // only check that would catch a Bun-only API sneaking into the bundle.
  step("Smoke-testing the built CLIs under Node");
  for (const bin of ["dist/cli.js"]) {
    const result = nodeRun([join(root, bin), "--help"]);
    if (result.code !== 0)
      fail(`${bin} failed to run under Node:\n${result.err}`);
  }

  step("Contents of the tarball");
  if ((await npmStream(["pack", "--dry-run"])) !== 0) fail("npm pack failed.");

  // --- 4. Authenticate ------------------------------------------------------

  const whoami = npmRun(["whoami"]);
  if (whoami.code === 0) {
    step(`Authenticated as ${whoami.out}`);
  } else if (opts.dryRun) {
    // A dry run must not open a browser. Report the gap and carry on.
    warn("Not logged in. A real release would open a browser to authenticate.");
  } else {
    step("Not logged in. Opening a browser to authenticate.");
    // Browser-based auth is npm's default and goes through your identity
    // provider and 2FA. Nothing is stored in the repo.
    if ((await npmStream(["login"])) !== 0) fail("npm login failed.");
  }

  // --- 5. Publish -----------------------------------------------------------

  if (opts.dryRun) {
    console.log(
      `\nDry run. ${id} would be published to the "${opts.distTag}" tag.`,
    );
    return;
  }

  console.log(
    `\nAbout to publish ${id} to the "${opts.distTag}" tag, publicly.`,
  );
  if ((await ask("Publish? [y/N] ")) !== "y")
    fail("Stopped. Nothing was published.");

  const args = ["publish", "--access", "public", "--tag", opts.distTag];
  if (opts.otp) args.push("--otp", opts.otp);
  if ((await npmStream(args)) !== 0) {
    fail(
      "Publish failed. If it asked for a one-time password, retry with --otp <code>.",
    );
  }

  // --- 6. Tag ---------------------------------------------------------------

  const tag = `claude-local-v${pkg.version}`;
  step(`Published. Tagging ${tag}`);
  if (capture("git", ["tag", "-a", tag, "-m", id], repoRoot).code !== 0) {
    warn(`Could not create tag ${tag}. Create it by hand if you want one.`);
  } else {
    console.log(
      `\nTag created locally. Push it with:\n  git push origin ${tag}`,
    );
  }

  console.log(`\n${id} is live.\n  npx ${pkg.name}`);
}

main().catch((error: unknown) => {
  fail(error instanceof Error ? error.message : String(error));
});
