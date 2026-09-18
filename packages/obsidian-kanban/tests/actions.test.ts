import { expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";

import { loadPlugin } from "./load";

interface Call {
  bin: string;
  argv: string[];
  opts: { cwd: string; timeout: number };
}

function withSpawnStub() {
  const calls: Call[] = [];
  const plugin = loadPlugin({
    execFile: (
      bin: string,
      argv: string[],
      opts: Call["opts"],
      cb: (e: null, out: string, err: string) => void,
    ) => {
      calls.push({ bin, argv, opts });
      cb(
        null,
        "DRY RUN\n  rolled — Acme: 2 item(s)\n  snapshot: /tmp/x.md",
        "",
      );
    },
  });
  return { calls, ...plugin };
}

test("Roll is one run of roll-forward with no flags", () => {
  const { ACTIONS } = loadPlugin();
  expect(ACTIONS.roll.map((s: { script: string }) => s.script)).toEqual([
    "roll",
  ]);
  expect(ACTIONS.roll[0].flags).toEqual([]);
});

test("Archive is one step, because the script turns the page itself", () => {
  // archive-done.ts runs the shift, so chaining it here too would shift twice.
  const { ACTIONS } = loadPlugin();
  expect(ACTIONS.archive.map((s: { script: string }) => s.script)).toEqual([
    "archive",
  ]);
  expect(ACTIONS.archive[0].flags).toEqual([]);
});

test("the scripts it points at exist in this repo", () => {
  const { SCRIPTS } = loadPlugin();
  const repo = join(import.meta.dir, "..", "..", "..");
  for (const rel of Object.values(SCRIPTS) as string[]) {
    expect(existsSync(join(repo, rel))).toBe(true);
  }
});

test("an explicit bun path wins over the search", () => {
  const { resolveBun } = loadPlugin();
  expect(resolveBun({ bunPath: "/custom/bun" })).toBe("/custom/bun");
});

test("the bun search returns a path, never an empty string", () => {
  // Obsidian does not inherit a login shell's PATH, so a bare "bun" is the
  // last resort rather than the first guess.
  const { resolveBun } = loadPlugin();
  expect(resolveBun({}).length).toBeGreaterThan(0);
});

test("spawns bun with the script, then the flags, from the toolkit folder", async () => {
  const { calls, runScript, defaultToolkitDir, SCRIPTS, resolveBun } =
    withSpawnStub();
  const plugin = { settings: { toolkitDir: "", bunPath: "" } };
  const r = await runScript(plugin, "roll", ["--dry-run"]);
  expect(r.ok).toBe(true);
  expect(calls).toHaveLength(1);
  expect(calls[0].bin).toBe(resolveBun({}));
  expect(calls[0].argv).toEqual([
    join(defaultToolkitDir(), SCRIPTS.roll),
    "--dry-run",
  ]);
  expect(calls[0].opts.cwd).toBe(defaultToolkitDir());
  expect(typeof calls[0].opts.timeout).toBe("number");
});

test("a configured toolkit folder is honoured", async () => {
  const { calls, runScript, SCRIPTS } = withSpawnStub();
  await runScript(
    { settings: { toolkitDir: "/tmp/elsewhere", bunPath: "" } },
    "archive",
  );
  expect(calls[0].argv).toEqual([join("/tmp/elsewhere", SCRIPTS.archive)]);
});

test("a failed spawn is reported, not swallowed", async () => {
  const plugin = loadPlugin({
    execFile: (
      _b: string,
      _a: string[],
      _o: unknown,
      cb: (e: Error, out: string, err: string) => void,
    ) => cb(new Error("bun not found"), "", "bun not found"),
  });
  const r = await plugin.runScript(
    { settings: { toolkitDir: "", bunPath: "" } },
    "roll",
  );
  expect(r.ok).toBe(false);
  expect(r.err).toContain("bun not found");
});

test("a test that forgets to stub child_process cannot spawn anything", () => {
  // The safety property this whole harness rests on. Without it a test calling
  // runScript without flags runs the real scripts against the real vault.
  const { runScript } = loadPlugin();
  return runScript({ settings: { toolkitDir: "", bunPath: "" } }, "roll").then(
    (r: { ok: boolean; err: string }) => {
      expect(r.ok).toBe(false);
      expect(r.err).toContain("not stubbed");
    },
  );
});
