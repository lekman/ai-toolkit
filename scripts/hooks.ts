/**
 * Report which git hooks are actually in force, and fail if a guard is inert.
 *
 * This exists because a hook can look installed and do nothing. Trunk claims
 * `core.hooksPath` the first time it runs in a clone, which silently stops
 * `.githooks/` being called at all — this repo lost its leak guard that way
 * on 13 Aug, and the commit-message guard added on 16 Aug was inert from the
 * moment it was written.
 *
 * So this does not install anything. Installing is the easy half and the half
 * that lies. It answers the only question worth asking: for each check, is
 * there a live path from `git commit` to the script?
 *
 *   bun run hooks
 */

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const root = execFileSync("git", ["rev-parse", "--show-toplevel"], {
  encoding: "utf8",
}).trim();

const git = (...args: string[]): string => {
  try {
    return execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
  } catch {
    return "";
  }
};

/** Which directory git will actually look in for hooks. */
const hooksPath = git("config", "--get", "core.hooksPath");
const trunkOwns = hooksPath.includes("/trunk/");
const localHooks = join(root, ".githooks");

/** Hook names Trunk is configured to fire, from its action triggers. */
const trunkTriggers = (): Set<string> => {
  const path = join(root, ".trunk", "trunk.yaml");
  if (!existsSync(path)) return new Set();
  const full = readFileSync(path, "utf8");
  // Scope to the `actions:` block. trunk.yaml carries several `enabled:`
  // lists — linters have one too — and matching the first found the wrong
  // one, reporting a registered action as inert.
  const yaml = /^actions:\n((?:[ \t].*\n|\n)*)/m.exec(full)?.[1] ?? "";
  const enabled =
    /^\s{2}enabled:\s*\n((?:\s+-\s+\S+\n)+)/m.exec(yaml)?.[1] ?? "";
  const names = new Set(
    [...enabled.matchAll(/-\s+(\S+)/g)].map((m) => m[1] as string),
  );
  const fired = new Set<string>();
  // Match each definition id to the git_hooks it triggers on, then keep only
  // the ones that are also in `enabled` — a definition alone does nothing.
  for (const block of yaml.split(/-\s+id:\s*/).slice(1)) {
    const id = /^(\S+)/.exec(block)?.[1];
    const hooks = /git_hooks:\s*\[([^\]]+)\]/.exec(block)?.[1];
    if (id && hooks && names.has(id)) {
      for (const h of hooks.split(",")) fired.add(h.trim());
    }
  }
  return fired;
};

interface Check {
  /** Git hook it must run on. */
  hook: string;
  /** What it protects against. */
  name: string;
}

const CHECKS: Check[] = [
  { hook: "pre-commit", name: "staged file content names a client" },
  { hook: "commit-msg", name: "commit message names a client" },
];

const fired = trunkTriggers();
const lines: string[] = [];
let broken = 0;

lines.push(`hooks path : ${hooksPath || "(unset — git uses .git/hooks)"}`);
lines.push(
  `owner      : ${trunkOwns ? "trunk" : hooksPath.endsWith(".githooks") ? "this repo (.githooks)" : "git default"}`,
);
lines.push("");

for (const check of CHECKS) {
  const viaTrunk = trunkOwns && fired.has(check.hook);
  const viaLocal =
    !trunkOwns &&
    hooksPath.endsWith(".githooks") &&
    existsSync(join(localHooks, check.hook));
  const live = viaTrunk || viaLocal;
  if (!live) broken += 1;
  lines.push(
    `${live ? "live   " : "INERT  "} ${check.hook.padEnd(12)} ${check.name}` +
      (live ? `  (via ${viaTrunk ? "trunk action" : ".githooks"})` : ""),
  );
  // A file in .githooks that nothing calls is the failure mode this exists
  // to name: it looks installed in every review of the repository.
  if (trunkOwns && existsSync(join(localHooks, check.hook)) && !viaTrunk) {
    lines.push(
      `        .githooks/${check.hook} exists but trunk owns the hooks path — it is never called`,
    );
  }
}

console.log(lines.join("\n"));

if (broken > 0) {
  console.error(
    `\n${broken} guard(s) inert. Register the check as a trunk action with a git_hooks trigger, or hand the hooks path back to .githooks. CI runs the same checks either way, so this is defence in depth, not the only line.`,
  );
  process.exit(1);
}
console.log("\nall guards have a live path from `git commit` to the script");
