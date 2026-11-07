# tasks

Gives every Claude Code session the task MCP server, and a
[work](skills/work/SKILL.md) skill on how to use it. The server is
[packages/tasks-mcp](../../packages/tasks-mcp): it runs once, on the machine
that holds the dashboard database, and every session reaches it over the
tailnet.

## Tools

| Tool                | Does                                                                    |
| ------------------- | ----------------------------------------------------------------------- |
| `task_search`       | Open items for a client, most important first, with computed priority   |
| `task_get`          | One item with its log, history, revision and the priority's reason      |
| `client_list`       | Clients and their workstreams, with their ids                           |
| `task_add`          | A new item, taking the client's classification and boundary             |
| `task_update`       | Change fields at the revision read; history records what changed        |
| `task_claim`        | Hold an item so other agents leave it alone                             |
| `task_release`      | Give a claim up                                                         |
| `task_log`          | An append-only progress note                                            |
| `task_complete`     | Done today, claim and blocked details cleared                           |
| `message_send`      | A message to another session by name, delivered by a relay              |
| `message_inbox`     | Messages to a session, or all not yet delivered                         |
| `message_delivered` | Mark messages delivered, once passed on or read                         |
| `host_stat_push`    | Store one load sample for a machine (CPU, memory, swap, disk, runners)  |
| `host_stat_list`    | Machines' newest load, last seen, limits broken, and samples in a range |

## Set Up a Machine

The URL comes from an environment variable and the token from the macOS
Keychain, read by a `headersHelper` each time Claude Code connects. Neither
is stored in this repository or in a shell profile.

1. Put the server's token in the Keychain (it is the `TASKS_MCP_TOKEN` line
   of the server's `.env`, also kept in the password manager). `-w` with no
   value prompts for it, so it never appears in the shell history:

   ```bash
   security add-generic-password -U -s tasks-mcp-token -a "$USER" -w
   ```

2. Set the URL in Claude Code's own settings, `~/.claude/settings.json`, so
   every session gets it, including the desktop app and Remote Control
   sessions, which do not read shell profiles such as `~/.zshenv`:

   ```json
   {
     "env": {
       "TASKS_MCP_URL": "http://<server's tailnet name>:7450/mcp"
     }
   }
   ```

   Without it, the session reports `Missing environment variables:
TASKS_MCP_URL` for `plugin:tasks:tasks`.

3. Install the plugin and restart the session:

   ```text
   /plugin install tasks@ai-toolkit
   ```

Check with `claude mcp list`: `plugin:tasks:tasks` should show Connected. A
401 means the Keychain token is wrong; a connection error means the URL is
wrong or the machine is not on the tailnet.

## Command Line

[`scripts/tasks`](scripts/tasks) does the same from Bash, for a session that
has no `tasks` MCP tools loaded yet. Plugins load their MCP servers when a
session starts, and only the operator can restart a session, so without it
every session started before an install or update would relay its task writes
through another session.

Install it once per machine. It writes a launcher to `~/.local/bin/tasks`
that runs the newest installed copy, so running sessions can use it at once
and plugin updates keep it current:

```bash
python3 ~/.claude/plugins/cache/ai-toolkit/tasks/*/scripts/tasks install
```

| Command                                                                                                                      | Does                                                                                                           |
| ---------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `tasks clients`                                                                                                              | Clients and their workstreams                                                                                  |
| `tasks search [--client ID] [--text …] [--unclaimed] [--claimed-by NAME] [--blocked] [--until DAY]`                          | Open items, most important first                                                                               |
| `tasks show ID`                                                                                                              | One item with its log                                                                                          |
| `tasks claim ID` / `tasks release ID [--force]`                                                                              | Hold an item, or give it up                                                                                    |
| `tasks start ID [--note …]` / `tasks state ID STATE [--note …]`                                                              | Set the state, with an optional note                                                                           |
| `tasks done ID [--note …] [--on DAY]`                                                                                        | Mark it done                                                                                                   |
| `tasks move ID DAY`                                                                                                          | Schedule it: `YYYY-MM-DD`, `today`, `tomorrow` or `backlog`                                                    |
| `tasks log ID [--status S] NOTE`                                                                                             | Append a progress note                                                                                         |
| `tasks add --client ID --title … [--day DAY] [--owner WHO] [--waiting-on WHO] [--pr REF] [--tracker KEY URL] [--details ID]` | Add an item                                                                                                    |
| `tasks set ID [--pr REF] [--drop-pr REF] [--tracker KEY URL] [--details ID]`                                                 | Link pull requests (`owner/repo#number`, added to the list the item holds), a tracker ticket or a details page |
| `tasks report [--from DAY] [--to DAY] [--client ID] [--format md\|json]`                                                     | What was done in a time window, per client and task. See [Report](#report)                                     |

Writes need `--by <session name>` or `TASKS_BY`. Add `--json` for the
server's answer. The address comes from `TASKS_MCP_URL` or the `env` block of
`~/.claude/settings.json`; the token from `TASKS_MCP_TOKEN` or the Keychain,
and it is never printed or put on a command line. Exit codes: 1 refused by
the server, 2 usage, 3 configuration (address or token), 4 server not
reachable.

## Trace Hooks

The plugin's hooks tie every piece of agent work to a task, so "what was done
here" and "what did you do last weekend" are answered from the task's log,
its pull requests and its Details page. The hook is
[`scripts/trace.ts`](scripts/trace.ts), run with `bun`.

| When the agent runs                                  | The hook needs                                 |
| ---------------------------------------------------- | ---------------------------------------------- |
| `git commit` or `git push`                           | A task this session claimed or added           |
| `gh pr create`                                       | That, and a Details page on one of those tasks |
| `task_complete`, `tasks done`, `tasks state ID done` | A Details page on that task                    |

A refused call says what to do: find, add or claim the task, or write the
Details page and set the task's `detailsId` to the page's file name. One
sentence on the page is enough when there is little to say. Work with pull
requests is completed by gh-events when it ships, not by the agent, so the
pull request is the last point the agent can still add the page.

The hook records each task a session claims or adds, by session id, in
`~/.claude/tasks-trace/`. Claims through the MCP tools and through the
`tasks` command both count.

Every gate fails open. An unreadable hook input, or a task database that does
not answer, lets the call through, so a database outage never stops work.

## Report

`tasks report` answers "what was done here" and "what did you do last
weekend" from the task database. The [report](skills/report/SKILL.md) skill
tells a session how to use it.

```bash
tasks report --from last-weekend --client acme
tasks report --from 2026-10-31 --to 2026-11-01 --client acme --client globex
tasks report --from last-month --format json
```

`--from` takes a day (`YYYY-MM-DD`) or a period: `today`, `yesterday`,
`this-week`, `last-week`, `last-weekend` or `last-month`. A week runs Monday
to Sunday, and `last-weekend` is the Saturday and Sunday before this week.
`--to` is the last day, and defaults to the end of what `--from` names. So
`--from 2026-10-01` alone is one day, and `--from 2026-10-01 --to today` is
everything since. Both days are included. Days and times are Europe/London.

The report reads every task of the chosen clients, in every state, and keeps
the tasks with activity in the window. Activity is a log note or a state
change. A move to another day, an edit or a claim alone is planning, so it
does not count. For each client, then each task, the report shows:

- the title, the task id, the state now, and the tracker key with its link
- the Details page id, or that there is none
- the pull requests, linked
- the state changes and log notes in the window, in time order, with who
  made each one

A last section lists, as gaps, the tasks with activity and no Details page.
Markdown is the default. `--format json` (or `--json`) gives the same content
for tools.

`task_search` returns at most 200 items and cannot page. When a client has
more tasks than that in one state, the report says it is incomplete and how
many tasks it could not read.
