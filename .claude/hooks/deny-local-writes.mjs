// @ts-check
/**
 * PreToolUse guard for shared mode. Denies Edit/Write/NotebookEdit that land
 * inside this repository's working copy, EXCEPT:
 *   - anything under .claude/worktrees/  (isolated git worktrees)
 *   - anything under a .workflow/ folder (scratch / generated output)
 *
 * Writes outside the repository (for example /tmp, or the auto-memory directory
 * under ~/.claude) are allowed: they do not touch the shared checkout.
 *
 * Why: in shared mode the agent must not edit the local checkout directly.
 * Isolated edits belong in a git worktree (call EnterWorktree, or spawn the task
 * with isolation: 'worktree'); the worktree lives under .claude/worktrees/ and
 * edits are allowed there. A mistaken or partial edit then never dirties the
 * working copy that every contributor shares.
 *
 * Opt-in and per-user: wire it in .claude/settings.local.json, not the committed
 * .claude/settings.json. See security/isolated/README.md, "Shared mode".
 *
 * Runtime-agnostic: plain ESM with no dependencies, so the wrapper can run it
 * under node (preferred, near-universal) or bun with no change. There is no build
 * step and no transpiled artifact to drift from the source. The `.mjs` extension
 * is deliberate: it makes node treat the file as ESM unconditionally — a `.js`
 * would need a package.json with "type":"module" — while bun runs it either way.
 * The pure decision function is exported so it can be unit-tested without
 * spawning a process.
 *
 * Contract: PreToolUse hooks receive the tool call as JSON on stdin. To block,
 * print a permissionDecision of "deny"; the reason is shown to the model so it
 * knows to switch to a worktree. Always exit 0 (allow AND deny) so the shell
 * wrapper can tell "ran" from "crashed" and fail open only on a real crash.
 */

import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { isAbsolute, join, relative, sep } from "node:path";

/**
 * Decide whether editing `absPath` violates the shared-mode guard.
 * Paths must be absolute and already real-path-resolved by the caller.
 * @param {string} toolName    the tool being called
 * @param {string} absPath     resolved target path ("" when there is none)
 * @param {string} projectDir  resolved repository root
 * @returns {string | null}    the offending repo-relative path to deny, or null to allow
 */
export function findSharedModeViolation(toolName, absPath, projectDir) {
  if (
    toolName !== "Edit" &&
    toolName !== "Write" &&
    toolName !== "NotebookEdit"
  ) {
    return null;
  }
  if (!absPath) return null;

  // Outside the repository working copy: not this guard's concern. The `+ sep`
  // stops a sibling like /repo-other from matching the /repo prefix.
  if (absPath !== projectDir && !absPath.startsWith(projectDir + sep)) {
    return null;
  }

  const rel = relative(projectDir, absPath);
  const parts = rel.split(sep);

  // Allowed islands inside the repo.
  if (parts[0] === ".claude" && parts[1] === "worktrees") return null;
  if (parts.includes(".workflow")) return null;

  return rel;
}

/**
 * Build the deny message shown to the model.
 * @param {string} rel  the offending repo-relative path
 * @returns {string}
 */
export function denyReason(rel) {
  return (
    "Shared-mode write guard: editing the local checkout is not allowed. " +
    `Target: ${rel}. Do not Edit/Write here. Create an isolated git worktree ` +
    "first (call EnterWorktree, or spawn the task with isolation: 'worktree'); " +
    "the worktree lives under .claude/worktrees/ and your edits are allowed " +
    "there. Scratch or generated output may go under a .workflow/ folder. Never " +
    "bypass this by writing outside the project."
  );
}

/**
 * realpath, falling back to the literal path for a not-yet-created file.
 * @param {string} p
 * @returns {string}
 */
function realpathOr(p) {
  try {
    return realpathSync(p);
  } catch {
    return p;
  }
}

/** Read all of stdin as UTF-8. Works under both node and bun. */
async function readStdin() {
  /** @type {Buffer[]} */
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString("utf8");
}

/** True when this file is the process entry point (not imported by a test). */
function isMain() {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return realpathSync(entry) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (isMain()) {
  const raw = await readStdin();

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    process.exit(0); // cannot parse: do not block, let the normal flow decide
  }

  /** @type {{ tool_name?: unknown; tool_input?: { file_path?: unknown; notebook_path?: unknown } | null }} */
  const call = parsed && typeof parsed === "object" ? parsed : {};

  const tool = typeof call.tool_name === "string" ? call.tool_name : "";
  const input = call.tool_input ?? {};
  const filePath = typeof input.file_path === "string" ? input.file_path : "";
  const notebookPath =
    typeof input.notebook_path === "string" ? input.notebook_path : "";
  const rawPath = filePath || notebookPath;

  if (rawPath) {
    const projectDir = realpathOr(
      process.env.CLAUDE_PROJECT_DIR || process.cwd(),
    );
    const absPath = realpathOr(
      isAbsolute(rawPath) ? rawPath : join(projectDir, rawPath),
    );
    const rel = findSharedModeViolation(tool, absPath, projectDir);
    if (rel !== null) {
      // Deny via JSON on stdout, and exit 0 so the wrapper does not read the
      // exit code as a crash. A PreToolUse "deny" decision blocks regardless.
      process.stdout.write(
        JSON.stringify({
          hookSpecificOutput: {
            hookEventName: "PreToolUse",
            permissionDecision: "deny",
            permissionDecisionReason: denyReason(rel),
          },
        }),
      );
    }
  }
  process.exit(0);
}
