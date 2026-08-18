/**
 * Put the release bot's credentials on every repository that needs them.
 *
 *   bun run scripts/sync-app-credentials.ts --app-id 123456 --key ~/keys/bot.pem
 *   bun run scripts/sync-app-credentials.ts --app-id 123456 --key ~/keys/bot.pem --apply
 *
 * The app id goes in as a repository **variable** and the private key as a
 * **secret**. The id is not sensitive — it appears in every workflow run — and
 * making it a variable keeps the secret list down to things that are actually
 * secret, so a surprising entry there is worth investigating.
 *
 * Dry run by default. It writes a credential to many repositories at once,
 * which is not something to discover you have done; --apply is the opt-in.
 *
 * Options:
 *   --app-id <n>     the GitHub App's id                       (required)
 *   --key <path>     PEM private key file                      (required)
 *   --repos a,b,c    only these repositories                   (default: all eligible)
 *   --apply          actually write                            (default: dry run)
 *
 * Forks and archived repositories are never included, and there is no flag to
 * include them. A fork belongs to someone else's release process, and an
 * archived repository is read-only — a credential there is one nobody can use
 * and nobody remembers to rotate.
 */

import { execFileSync } from "node:child_process";
import {
  closeSync,
  existsSync,
  fstatSync,
  openSync,
  readFileSync,
} from "node:fs";

const argv = process.argv.slice(2);
const flag = (name: string): string | undefined => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : undefined;
};
const has = (name: string): boolean => argv.includes(`--${name}`);

const VARIABLE = "APP_ID";
const SECRET = "APP_PRIVATE_KEY";

const gh = (args: string[], stdin?: string): string =>
  execFileSync("gh", args, {
    encoding: "utf8",
    ...(stdin === undefined ? {} : { input: stdin }),
  }).trim();

const fail = (message: string): never => {
  console.error(`error: ${message}`);
  process.exit(2);
};

const appId = flag("app-id") ?? fail("--app-id is required");
const keyPath = (flag("key") ?? fail("--key is required")).replace(
  /^~/,
  process.env["HOME"] ?? "~",
);
if (!/^\d+$/.test(appId)) fail(`--app-id must be numeric, got "${appId}"`);
if (!existsSync(keyPath)) fail(`no key file at ${keyPath}`);

// A world-readable private key is worth stopping for. It is about to be copied
// to a dozen places; the copy is not the problem, the original is.
//
// The mode is checked on the open handle rather than on the path, and the same
// handle is then read. Checking the path and reading it afterwards leaves a
// window in which the file that was approved is not the file that is sent —
// the whole point of the check is that this one is trusted.
//
// Read once rather than per repository: the file is small, and re-reading it
// in a loop widens the window in which a key sits in memory for no benefit.
const fd = openSync(keyPath, "r");
let privateKey: string;
try {
  const mode = fstatSync(fd).mode & 0o777;
  if (mode & 0o077) {
    fail(
      `${keyPath} is mode ${mode.toString(8)} — readable beyond its owner. chmod 600 it before syncing.`,
    );
  }
  privateKey = readFileSync(fd, "utf8");
} finally {
  closeSync(fd);
}

interface Repo {
  isArchived: boolean;
  isFork: boolean;
  name: string;
}

const owner = gh(["api", "user", "--jq", ".login"]);
const all = JSON.parse(
  gh([
    "repo",
    "list",
    owner,
    "--limit",
    "200",
    "--json",
    "name,isFork,isArchived",
  ]),
) as Repo[];

const only = flag("repos")
  ?.split(",")
  .map((r) => r.trim());

const targets = all
  .filter((r) => (only ? only.includes(r.name) : true))
  // Not optional, by design — see the header. Archived is read-only and a fork
  // is someone else's release process.
  .filter((r) => !r.isArchived && !r.isFork)
  .map((r) => r.name)
  .sort();

if (only) {
  for (const name of only) {
    if (!targets.includes(name)) {
      console.warn(`  skipping ${name}: it is archived, a fork, or not found`);
    }
  }
}

if (targets.length === 0) fail("no eligible repositories");

const applying = has("apply");
console.log(
  `${applying ? "Writing" : "DRY RUN — would write"} ${VARIABLE} (variable) and ${SECRET} (secret)`,
);
console.log(
  `to ${targets.length} repositor${targets.length === 1 ? "y" : "ies"} owned by ${owner}:\n`,
);

let failed = 0;
for (const name of targets) {
  const repo = `${owner}/${name}`;
  if (!applying) {
    console.log(`  would update  ${repo}`);
    continue;
  }
  try {
    gh(["variable", "set", VARIABLE, "--repo", repo, "--body", appId]);
    // Via stdin, not --body: a private key passed as an argument is readable
    // from the process table for as long as the call runs. `gh secret set`
    // reads the value from standard input when --body is omitted; it has no
    // --body-file, which an earlier version of this script assumed and which
    // failed on every repository after the first variable was written.
    gh(["secret", "set", SECRET, "--repo", repo], privateKey);
    console.log(`  updated       ${repo}`);
  } catch (error) {
    failed += 1;
    console.error(
      `  FAILED        ${repo}: ${(error as Error).message.split("\n")[0]}`,
    );
  }
}

if (!applying) {
  console.log(
    `\nNothing was written. Re-run with --apply once the list above looks right.`,
  );
} else if (failed > 0) {
  console.error(`\n${failed} repositor${failed === 1 ? "y" : "ies"} failed.`);
  process.exit(1);
} else {
  console.log(
    `\nDone. Workflows read these as \${{ vars.${VARIABLE} }} and \${{ secrets.${SECRET} }}.`,
  );
  console.log(
    `The App must also be installed on each repository — credentials alone do not grant access.`,
  );
}
