# Context

Keep each session's context window small. Everything in the window is sent again
on every turn, so a large window costs more per turn, answers more slowly, and
pushes out detail the session still needs. The cheapest token is the one that
never enters the window. The next cheapest is one that leaves it automatically.

Settings and limits below are from the Claude Code documentation, checked on 28
Oct 2026 against Claude Code 2.1.310. They change between releases, so check
[env-vars](https://code.claude.com/docs/en/env-vars.md) and
[settings](https://code.claude.com/docs/en/settings-reference.md) before you
rely on a number.

## What Fills the Window

Two kinds of cost, and they need different fixes:

- **Fixed cost, paid on every turn from the start:** the system prompt, every
  `CLAUDE.md` and its `@` imports, rules without `paths:`, the memory index,
  skill descriptions, and the name of every MCP tool. Trim these once and every
  session benefits.
- **Growth, added as the session works:** tool output, file reads, screenshots
  and the conversation itself. Cap it where it enters, and let compaction remove
  it when it is no longer needed.

Run `/context` to see the split for the current session. Measure before and
after any change on this page; the values here are starting points, not results.

## Trim Automatically

Compaction replaces the conversation with a summary. Claude Code does it on its
own in two cases, and both can be tuned:

| Setting                               | What it does                                                                                     | Default         |
| ------------------------------------- | ------------------------------------------------------------------------------------------------ | --------------- |
| `idleCompaction` (setting)            | Compacts a session that has sat idle, before the next turn has to resend the whole conversation. | On              |
| `CLAUDE_CODE_IDLE_COMPACT_MIN_TOKENS` | Context size at which idle compaction applies. Values under 100,000 are raised to 100,000.       | 200,000         |
| `autoCompactEnabled` (setting)        | Compacts when the window fills. Turning it off also turns off idle compaction.                   | On              |
| `CLAUDE_AUTOCOMPACT_PCT_OVERRIDE`     | Percentage of the auto-compact window at which compaction starts. Can only lower the threshold.  | Not stated      |
| `CLAUDE_CODE_AUTO_COMPACT_WINDOW`     | The auto-compact window in tokens, 100,000 to 1,000,000.                                         | Tuned per model |

Compaction is not free. The summary is a model call of its own, and the summary
drops detail. Set the thresholds by role:

- **Long-lived sessions that plan and hand out work** (an orchestrator, a
  commander) wake often and keep their state in files. Compact them early: idle
  compaction at the 100,000 floor and auto-compaction at 60 percent. See
  [settings/orchestrator.json](settings/orchestrator.json).
- **Sessions doing hands-on work** (a pull request, a database check) need exact
  file paths, error text and what was already ruled out. Keep the default
  thresholds and cap tool output instead. See
  [settings/worker.json](settings/worker.json).

Load a template for one session with
`claude --settings practices/context/settings/orchestrator.json`, or copy its
`env` block into that project's `.claude/settings.json`. Putting it in
`~/.claude/settings.json` applies it to every session on the machine.

## Survive Compaction

A summary keeps the gist and loses the specifics. Two habits make that loss
cheap:

- **Keep working state on disk,** not only in the conversation. A session that
  writes its branch, decisions, next step and what it ruled out to
  `.tmp/session-state.md` loses nothing when it compacts. An orchestrator's
  ledger is the same idea.
- **Re-inject it after compaction.** The `wrap` plugin's `SessionStart` hook for
  the `compact` matcher prints `.tmp/session-state.md` back into the session
  after every compaction, with the path of the full transcript for anything
  else. See [plugins/wrap](../../plugins/wrap/README.md).

A `PreCompact` hook cannot add instructions to the summary; it can only block
compaction. To steer one summary, run `/compact` with a focus, for example
`/compact keep the failing test names and the migration order`.

## Keep It Out of the Window

- **Scope MCP servers to the projects that use them.** Tool search defers full
  tool definitions, but every tool's name is still loaded at session start. A
  server added at user scope lists its tools in every repository on the machine.
  Add it with `claude mcp add … -s local` from the repository that needs it
  instead. Connectors from a claude.ai account load in every project and are
  managed in the account.
- **Cap tool output where it enters.** `BASH_MAX_OUTPUT_LENGTH` (characters,
  default 30,000), `MAX_MCP_OUTPUT_TOKENS` (default 25,000) and
  `CLAUDE_CODE_FILE_READ_MAX_OUTPUT_TOKENS` (default 25,000). MCP text over
  50,000 characters is saved to a file regardless.
- **Write scripts that print metadata, not content.** A script that writes its
  result to a file and prints one line (a count, a path, a status) keeps the
  data out of the window until the session decides to read it. The
  [meeting plugin's export](../../plugins/meeting/scripts/export.ts) works this
  way.
- **Filter at the source.** `gh … --json … -q`, `jq`, `head`, `grep -c`. Ask for
  the answer, not the dataset.
- **Send wide reads to a subagent.** A search across many files or a long log
  read in a subagent returns only its conclusion to the main session.
- **Load rules when they apply.** A rule in `.claude/rules/` with `paths:`
  frontmatter loads only when a matching file is read or edited. Rules without
  `paths:` load at launch, every session. Path-scoped rules are not re-injected
  after compaction; they load again on demand.
- **Describe screenshots instead of pasting them,** or crop them to the part
  that matters. A full-screen image costs far more than a line of text saying
  what is on it, and it can carry data that should not be in a transcript at
  all.
- **End a topic with `/clear` or `/wrap:session`.** One session per topic keeps
  the window to what that topic needs.

## Fixed Costs to Review

Check these when `/context` shows a large fixed share:

- The size of `CLAUDE.md` and everything it imports with `@`. Move instructions
  that apply only sometimes into path-scoped rules or skills.
- The memory index. Keep it to one line per memory.
- MCP servers and connectors that the project never calls.
- Plugins installed but not used in this kind of work; each adds its skill
  descriptions.
