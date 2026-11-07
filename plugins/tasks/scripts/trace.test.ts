import { describe, expect, it } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { completes, record, recorded, ships, taskIdsFrom } from "./trace.ts";

const TOOL = "mcp__plugin_tasks_tasks__";
const HOOK = join(import.meta.dir, "trace.ts");

describe("ships", () => {
  it("tells commits and pushes from new pull requests", () => {
    for (const c of [
      "git commit -m 'fix: x'",
      "git -C ../repo commit -q -F -",
      "git -c user.name=x commit",
      "git push -u origin feat/x",
      "cd repo && git push",
    ])
      expect(ships(c)).toBe("commit");
    for (const c of ["gh pr create --base main", "gh --repo a/b pr create"])
      expect(ships(c)).toBe("pr");
  });

  it("leaves reading and local git work alone", () => {
    for (const c of [
      "git status",
      "git log --grep commit",
      "git add plugins/tasks/README.md",
      "gh pr view 12",
      "gh pr list --state open",
    ])
      expect(ships(c)).toBe(null);
  });
});

describe("completes", () => {
  it("reads the id from the MCP tool and the tasks command", () => {
    expect(completes(`${TOOL}task_complete`, { id: "01abc" })).toBe("01abc");
    expect(completes("Bash", { command: "tasks --by Ops done 01abc" })).toBe(
      "01abc",
    );
    expect(
      completes("Bash", {
        command: "python3 ~/x/scripts/tasks state 01abc done --note y",
      }),
    ).toBe("01abc");
  });

  it("ignores other states, other tools and other commands", () => {
    expect(completes("Bash", { command: "tasks state 01abc doing" })).toBe(
      null,
    );
    expect(completes(`${TOOL}task_update`, { id: "01abc" })).toBe(null);
    expect(completes("Bash", { command: "ls plugins/tasks" })).toBe(null);
  });
});

describe("taskIdsFrom", () => {
  it("records a claim from its input", () => {
    expect(taskIdsFrom(`${TOOL}task_claim`, { id: "01abc" }, {})).toEqual([
      "01abc",
    ]);
  });

  it("records an added task from the MCP answer in either shape", () => {
    const json = '{"id":"01new","title":"Ship it"}';
    expect(
      taskIdsFrom(`${TOOL}task_add`, {}, [{ type: "text", text: json }]),
    ).toEqual(["01new"]);
    expect(
      taskIdsFrom(
        `${TOOL}task_add`,
        {},
        {
          content: [{ type: "text", text: json }],
        },
      ),
    ).toEqual(["01new"]);
  });

  it("records claims and adds made with the tasks command", () => {
    const bash = (command: string, stdout: string) =>
      taskIdsFrom("Bash", { command }, { stdout });
    expect(bash("tasks --by Ops claim 01abc", "claimed 01abc")).toEqual([
      "01abc",
    ]);
    expect(
      bash("tasks add --client acme --title 'Ship it'", "added 01new  Ship it"),
    ).toEqual(["01new"]);
    expect(
      bash("tasks --json add --client acme --title x", '{"id": "01new"}'),
    ).toEqual(["01new"]);
    expect(bash("tasks search --text x", "01abc  Ship it")).toEqual([]);
  });
});

describe("record and recorded", () => {
  it("keeps every task a session recorded, once each", () => {
    const dir = mkdtempSync(join(tmpdir(), "trace-"));
    expect(recorded(dir, "s1")).toEqual([]);
    record(dir, "s1", ["a"]);
    record(dir, "s1", ["b", "a"]);
    expect(recorded(dir, "s1")).toEqual(["a", "b"]);
    expect(recorded(dir, "s2")).toEqual([]);
  });
});

/** Run the hook as Claude Code does, with a stub `tasks` command. */
function hook(payload: object, show: object | null, dir: string) {
  const cli = join(dir, "tasks-stub.py");
  writeFileSync(
    cli,
    show
      ? `print(${JSON.stringify(JSON.stringify(show))})\n`
      : "import sys\nsys.exit(4)\n",
  );
  const run = Bun.spawnSync(["bun", HOOK], {
    stdin: new TextEncoder().encode(JSON.stringify(payload)),
    env: { ...process.env, TASKS_TRACE_DIR: dir, TASKS_CLI: cli },
  });
  const out = run.stdout.toString().trim();
  return out ? JSON.parse(out).hookSpecificOutput : null;
}

describe("the hook", () => {
  const pre = (tool: string, input: object) => ({
    hook_event_name: "PreToolUse",
    session_id: "s1",
    tool_name: tool,
    tool_input: input,
  });

  it("refuses a commit until the session has a task, then lets it through", () => {
    const dir = mkdtempSync(join(tmpdir(), "trace-"));
    const commit = pre("Bash", { command: "git commit -m x" });
    expect(hook(commit, null, dir)?.permissionDecision).toBe("deny");
    hook(
      {
        hook_event_name: "PostToolUse",
        session_id: "s1",
        tool_name: `${TOOL}task_claim`,
        tool_input: { id: "01abc" },
        tool_response: {},
      },
      null,
      dir,
    );
    expect(hook(commit, null, dir)).toBe(null);
  });

  it("refuses completing a task without a Details page", () => {
    const dir = mkdtempSync(join(tmpdir(), "trace-"));
    const done = pre(`${TOOL}task_complete`, { id: "01abc" });
    const refused = hook(done, { id: "01abc", title: "Ship it" }, dir);
    expect(refused?.permissionDecision).toBe("deny");
    expect(refused?.permissionDecisionReason).toContain('"Ship it"');
    expect(
      hook(done, { id: "01abc", title: "Ship it", detailsId: "ship-it" }, dir),
    ).toBe(null);
  });

  it("refuses a pull request until the session's task has a Details page", () => {
    const dir = mkdtempSync(join(tmpdir(), "trace-"));
    record(dir, "s1", ["01abc"]);
    const pr = pre("Bash", { command: "gh pr create --fill" });
    expect(
      hook(pr, { id: "01abc", title: "Ship it" }, dir)?.permissionDecision,
    ).toBe("deny");
    expect(
      hook(pr, { id: "01abc", title: "Ship it", detailsId: "ship-it" }, dir),
    ).toBe(null);
    // A commit needs only the task.
    expect(
      hook(pre("Bash", { command: "git commit -m x" }), { id: "01abc" }, dir),
    ).toBe(null);
  });

  it("lets the call through when the database does not answer", () => {
    const dir = mkdtempSync(join(tmpdir(), "trace-"));
    expect(hook(pre(`${TOOL}task_complete`, { id: "01abc" }), null, dir)).toBe(
      null,
    );
  });

  it("lets an unreadable input through", () => {
    const run = Bun.spawnSync(["bun", HOOK], {
      stdin: new TextEncoder().encode("not json"),
    });
    expect(run.exitCode).toBe(0);
    expect(run.stdout.toString().trim()).toBe("");
  });
});
