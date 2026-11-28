import { afterAll, beforeAll, expect, test } from "bun:test";
import { execFileSync, spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// The scan reads its term list from the repository it runs in, so each test
// runs it inside a throwaway repository with a made-up term.
const TERM = "zebracorp-test-term";
const SCRIPT = join(import.meta.dir, "check-no-client-content.sh");
let repo = "";

/**
 * Runs the scan in the throwaway repository.
 * @param args extra arguments for the script
 * @returns the exit code and what the script wrote to stderr
 */
function scan(...args: string[]): { code: number; stderr: string } {
  const result = spawnSync(
    "bash",
    ["scripts/check-no-client-content.sh", ...args],
    { cwd: repo, encoding: "utf8" },
  );
  return { code: result.status ?? -1, stderr: result.stderr };
}

beforeAll(() => {
  repo = mkdtempSync(join(tmpdir(), "client-content-"));
  execFileSync("git", ["init", "--quiet"], { cwd: repo });
  mkdirSync(join(repo, "scripts"));
  cpSync(SCRIPT, join(repo, "scripts", "check-no-client-content.sh"));
  writeFileSync(join(repo, "scripts", "client-terms.txt"), `${TERM}\n`);
});

afterAll(() => {
  rmSync(repo, { force: true, recursive: true });
});

test("passes when no file names a term", () => {
  writeFileSync(join(repo, "note.txt"), "nothing to see\n");
  expect(scan().code).toBe(0);
});

test("a failure says where, what to change, the rule and its docs", () => {
  writeFileSync(join(repo, "note.txt"), `a line about ${TERM}\n`);
  const { code, stderr } = scan();
  expect(code).toBe(1);
  expect(stderr).toContain("note.txt");
  expect(stderr).toContain("Replace with a placeholder");
  expect(stderr).toContain("Rule: no-client-content");
  expect(stderr).toContain("Docs: docs/checks.md#no-client-content");
});

test("a quiet failure on staged content names the file and hides the term", () => {
  writeFileSync(join(repo, "note.txt"), `a line about ${TERM}\n`);
  execFileSync("git", ["add", "note.txt"], { cwd: repo });
  const { code, stderr } = scan("--staged", "--quiet");
  expect(code).toBe(1);
  expect(stderr).toContain("note.txt");
  expect(stderr).not.toContain(TERM);
  expect(stderr).toContain("Rule: no-client-content");
});

test("a quiet failure on the working tree names the file and hides the term", () => {
  writeFileSync(join(repo, "note.txt"), `a line about ${TERM}\n`);
  const { code, stderr } = scan("--quiet");
  expect(code).toBe(1);
  expect(stderr).toContain("note.txt");
  expect(stderr).not.toContain(TERM);
});

test("a quiet failure on a commit message hides the term", () => {
  const message = join(repo, "message.txt");
  writeFileSync(message, `fix: a change for ${TERM}\n`);
  const { code, stderr } = scan("--message", message, "--quiet");
  rmSync(message);
  expect(code).toBe(1);
  expect(stderr).not.toContain(TERM);
});
