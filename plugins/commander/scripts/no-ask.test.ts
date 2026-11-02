import { describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  nameFromArgs,
  reason,
  rosterMatch,
  rosterNames,
  sessionName,
} from "./no-ask.ts";

const dir = mkdtempSync(join(tmpdir(), "no-ask-"));
const roster = join(dir, "commander.json");
writeFileSync(
  roster,
  JSON.stringify({
    commander: "Commander",
    agents: [{ name: "Iviron" }, { name: "Ops Portal" }],
  }),
);
const sessions = join(dir, "sessions");
mkdirSync(sessions);
writeFileSync(
  join(sessions, "1.json"),
  JSON.stringify({ sessionId: "s-1", name: "iviron-69" }),
);
writeFileSync(
  join(sessions, "2.json"),
  JSON.stringify({ sessionId: "s-2", name: "Atlas" }),
);

describe("no-ask", () => {
  it("reads the commander and agents from the roster", () => {
    expect(rosterNames(roster)).toEqual({
      commander: "Commander",
      names: ["Commander", "Iviron", "Ops Portal"],
    });
    expect(rosterNames(join(dir, "missing.json"))).toEqual({
      commander: null,
      names: [],
    });
  });
  it("matches roster names as a prefix, without case, spaces as hyphens", () => {
    const { names } = rosterNames(roster);
    expect(rosterMatch("iviron-69", names)).toBe("Iviron");
    expect(rosterMatch("Ops Portal", names)).toBe("Ops Portal");
    expect(rosterMatch("ops-portal", names)).toBe("Ops Portal");
    expect(rosterMatch("Commander", names)).toBe("Commander");
    expect(rosterMatch("Atlas", names)).toBeNull();
    expect(rosterMatch("ivironx", names)).toBeNull();
  });
  it("finds a session's name by its id", () => {
    expect(sessionName(sessions, "s-1")).toBe("iviron-69");
    expect(sessionName(sessions, "nope")).toBeNull();
  });
  it("reads the name from a claude command line", () => {
    expect(
      nameFromArgs("claude --resume abc --remote-control Ops Portal"),
    ).toBe("Ops Portal");
    expect(
      nameFromArgs(
        "claude --agent commander:commander --remote-control Commander",
      ),
    ).toBe("Commander");
    expect(nameFromArgs("claude --remote-control 'Gaps'")).toBe("Gaps");
    expect(nameFromArgs("claude --name Atlas --model x")).toBe("Atlas");
    expect(nameFromArgs("claude --resume abc")).toBeNull();
  });
  it("tells the commander and a worker each how to ask instead", () => {
    expect(reason(true)).toContain("notify.ts ask");
    expect(reason(false)).toContain("message_send to Commander");
  });
  it("denies a roster worker and lets anyone else through, end to end", async () => {
    const run = async (id: string) => {
      const p = Bun.spawn(["bun", join(import.meta.dir, "no-ask.ts")], {
        stdin: new TextEncoder().encode(
          JSON.stringify({ session_id: id, tool_name: "AskUserQuestion" }),
        ),
        stdout: "pipe",
        env: {
          ...process.env,
          COMMANDER_ROSTER: roster,
          CLAUDE_SESSIONS_DIR: sessions,
        },
      });
      await p.exited;
      return (await new Response(p.stdout).text()).trim();
    };
    expect(
      JSON.parse(await run("s-1")).hookSpecificOutput.permissionDecision,
    ).toBe("deny");
    expect(await run("s-2")).toBe("");
  });
});
