import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const HOOK = join(import.meta.dir, "after-compact.sh");

/** Run the hook in a fresh directory with the given stdin and files. */
function run(stdin: string, files: Record<string, string> = {}): string {
  const dir = mkdtempSync(join(tmpdir(), "after-compact-"));
  for (const [path, body] of Object.entries(files)) {
    mkdirSync(join(dir, path, ".."), { recursive: true });
    writeFileSync(join(dir, path), body);
  }
  const proc = Bun.spawnSync(["bash", HOOK], {
    cwd: dir,
    stdin: Buffer.from(stdin),
  });
  expect(proc.exitCode).toBe(0);
  return proc.stdout.toString();
}

test("prints nothing when there is no state file and no transcript", () => {
  expect(run('{"source":"compact"}')).toBe("");
});

test("re-injects the working-state file", () => {
  const out = run('{"source":"compact"}', {
    ".tmp/session-state.md": "Branch: feat/x\nNext: run the tests",
  });
  expect(out).toContain("Next: run the tests");
  expect(out).toContain(".tmp/session-state.md");
});

test("points at the transcript when it exists", () => {
  const dir = mkdtempSync(join(tmpdir(), "transcript-"));
  const path = join(dir, "session.jsonl");
  writeFileSync(path, "{}\n");
  const out = run(JSON.stringify({ source: "compact", transcript_path: path }));
  expect(out).toContain(path);
  expect(out).toContain("grep");
});

test("ignores a transcript path that does not exist", () => {
  expect(run('{"transcript_path":"/no/such/file.jsonl"}')).toBe("");
});

test("survives empty or broken input", () => {
  expect(run("")).toBe("");
  expect(run("not json")).toBe("");
});
