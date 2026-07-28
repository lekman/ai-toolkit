/**
 * Maintainer release script: build, assemble, verify, publish — for every
 * workspace package whose local version is ahead of the npm registry.
 *
 * Packages whose local version matches the registry are skipped, so a release
 * run only touches what actually changed.
 *
 * Authentication is browser-based (`npm login`), so no token is ever written
 * into the repo or the environment. npm revoked classic tokens in early 2026
 * and write-enabled granular tokens now expire in days, which makes a
 * long-lived local token both unavailable and a bad idea.
 *
 *   bun run release              # publish outdated packages to latest
 *   bun run release --dry-run    # do everything except the publish call
 *   bun run release --tag next   # publish under a different dist-tag
 *   bun run release --otp 123456 # pass a 2FA code non-interactively
 *
 * Publishing from CI instead? Use npm trusted publishing (OIDC) rather than a
 * secret — it needs no token at all and attaches provenance automatically.
 * Provenance is not available from a laptop, so this script does not ask for it.
 */

import { spawn, spawnSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  readFileSync,
  readdirSync,
  statSync,
} from "node:fs";
import { createInterface } from "node:readline/promises";
import { join } from "node:path";

const repoRoot = join(import.meta.dir, "..");
const packagesDir = join(repoRoot, "packages");

interface Options {
  dryRun: boolean;
  distTag: string;
  otp?: string;
}

interface Pkg {
  dir: string;
  name: string;
  version: string;
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

function capture(cmd: string, args: string[], cwd = repoRoot) {
  const r = spawnSync(cmd, args, { encoding: "utf8", cwd });
  return {
    code: r.status ?? 1,
    out: (r.stdout ?? "").trim(),
    err: (r.stderr ?? "").trim(),
  };
}

function stream(cmd: string, args: string[], cwd = repoRoot): Promise<number> {
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

/** Numeric semver comparison; prerelease suffixes are ignored. */
function semverGt(a: string, b: string): boolean {
  const parse = (v: string) => v.split("-")[0]!.split(".").map(Number);
  const [pa, pb] = [parse(a), parse(b)];
  for (let i = 0; i < 3; i++) {
    if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) > (pb[i] ?? 0);
  }
  return false;
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

function workspacePackages(): Pkg[] {
  return readdirSync(packagesDir)
    .map((entry) => join(packagesDir, entry))
    .filter((dir) => existsSync(join(dir, "package.json")))
    .map((dir) => {
      const pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
      return { dir, name: pkg.name as string, version: pkg.version as string };
    });
}

async function main(): Promise<void> {
  const opts = parseArgs(process.argv.slice(2));
  const { npm, node } = resolveRuntime();
  const npmRun = (args: string[], cwd?: string) =>
    capture(npm[0]!, [...npm.slice(1), ...args], cwd);
  const npmStream = (args: string[], cwd?: string) =>
    stream(npm[0]!, [...npm.slice(1), ...args], cwd);
  const nodeRun = (args: string[], cwd?: string) =>
    capture(node[0]!, [...node.slice(1), ...args], cwd);

  // --- 1. Decide what needs releasing ---------------------------------------

  step("Comparing workspace versions with the registry");
  const toRelease: Pkg[] = [];
  for (const pkg of workspacePackages()) {
    const published = npmRun(["view", pkg.name, "versions", "--json"]);
    if (published.code !== 0) {
      console.log(`  ${pkg.name}@${pkg.version} — not on the registry yet, first publish`);
      toRelease.push(pkg);
      continue;
    }
    const parsed = JSON.parse(published.out) as string[] | string;
    const versions = Array.isArray(parsed) ? parsed : [parsed];
    const latest = versions.reduce((a, b) => (semverGt(b, a) ? b : a));
    if (versions.includes(pkg.version)) {
      console.log(`  ${pkg.name}@${pkg.version} — already published, skipping`);
    } else if (semverGt(pkg.version, latest)) {
      console.log(`  ${pkg.name}@${pkg.version} — ahead of ${latest}, will publish`);
      toRelease.push(pkg);
    } else {
      warn(`${pkg.name}@${pkg.version} is behind the registry (${latest}). Skipping.`);
    }
  }

  if (toRelease.length === 0) {
    console.log("\nNothing to release. Every package matches the registry.");
    return;
  }

  // --- 2. Preflight ---------------------------------------------------------

  step("Checking the working tree");
  for (const pkg of toRelease) {
    const dirty = capture("git", ["status", "--porcelain", "--", pkg.dir]).out;
    if (dirty && opts.dryRun) {
      warn(`Uncommitted changes under ${pkg.name}. A real release would stop here.`);
    } else if (dirty) {
      fail(
        `Uncommitted changes under ${pkg.name}. Publish only what is committed:\n${dirty}`,
      );
    }
  }

  const branch = capture("git", ["rev-parse", "--abbrev-ref", "HEAD"]).out;
  if (branch !== "main") {
    warn(`On branch "${branch}", not main.`);
    // A dry run stays non-interactive; a real release asks before continuing.
    if (!opts.dryRun && (await ask("Continue anyway? [y/N] ")) !== "y")
      fail("Stopped.");
  }

  // --- 3. Build and verify each package -------------------------------------

  for (const pkg of toRelease) {
    const id = `${pkg.name}@${pkg.version}`;

    step(`[${pkg.name}] Typecheck and build`);
    if ((await stream("bun", ["run", "check"], pkg.dir)) !== 0)
      fail(`Build failed for ${id}.`);

    step(`[${pkg.name}] Assembling package files`);
    // npm includes a LICENSE next to package.json automatically. The repo keeps
    // one canonical copy at the root, so mirror it in rather than duplicating
    // it in version control.
    copyFileSync(join(repoRoot, "LICENSE"), join(pkg.dir, "LICENSE"));

    const bin = join(pkg.dir, "dist/cli.js");
    if (!existsSync(bin)) fail(`Missing build output: ${bin}`);
    if (!readFileSync(bin, "utf8").startsWith("#!/usr/bin/env node")) {
      fail(`${id}: dist/cli.js lost its shebang — it would not run as a CLI.`);
    }
    if (!(statSync(bin).mode & 0o111)) fail(`${id}: dist/cli.js is not executable.`);

    // The artifact must run under plain Node, not just under Bun. This is the
    // only check that would catch a Bun-only API sneaking into the bundle.
    step(`[${pkg.name}] Smoke-testing the built CLI under Node`);
    const smoke = nodeRun([bin, "--help"], pkg.dir);
    if (smoke.code !== 0)
      fail(`${id}: dist/cli.js failed to run under Node:\n${smoke.err}`);

    step(`[${pkg.name}] Contents of the tarball`);
    if ((await npmStream(["pack", "--dry-run"], pkg.dir)) !== 0)
      fail(`npm pack failed for ${id}.`);
  }

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

  const ids = toRelease.map((p) => `${p.name}@${p.version}`);
  if (opts.dryRun) {
    console.log(
      `\nDry run. Would publish to the "${opts.distTag}" tag:\n  ${ids.join("\n  ")}`,
    );
    return;
  }

  console.log(
    `\nAbout to publish to the "${opts.distTag}" tag, publicly:\n  ${ids.join("\n  ")}`,
  );
  if ((await ask("Publish? [y/N] ")) !== "y")
    fail("Stopped. Nothing was published.");

  const tags: string[] = [];
  for (const pkg of toRelease) {
    const id = `${pkg.name}@${pkg.version}`;
    const args = ["publish", "--access", "public", "--tag", opts.distTag];
    if (opts.otp) args.push("--otp", opts.otp);
    if ((await npmStream(args, pkg.dir)) !== 0) {
      fail(
        `Publish failed for ${id}. If it asked for a one-time password, retry with --otp <code>.`,
      );
    }

    // --- 6. Tag -------------------------------------------------------------

    const tag = `${pkg.name.split("/").pop()}-v${pkg.version}`;
    step(`Published ${id}. Tagging ${tag}`);
    if (capture("git", ["tag", "-a", tag, "-m", id]).code !== 0) {
      warn(`Could not create tag ${tag}. Create it by hand if you want one.`);
    } else {
      tags.push(tag);
    }
  }

  if (tags.length > 0) {
    console.log(
      `\nTags created locally. Push them with:\n  git push origin ${tags.join(" ")}`,
    );
  }
  console.log(
    `\nLive:\n${toRelease.map((p) => `  npx ${p.name}`).join("\n")}`,
  );
}

main().catch((error: unknown) => {
  fail(error instanceof Error ? error.message : String(error));
});
