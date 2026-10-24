# tasks

Gives every Claude Code session the task MCP server, and a
[work](skills/work/SKILL.md) skill on how to use it. The server is
[packages/tasks-mcp](../../packages/tasks-mcp): it runs once, on the machine
that holds the dashboard database, and every session reaches it over the
tailnet.

## Tools

| Tool            | Does                                                                  |
| --------------- | --------------------------------------------------------------------- |
| `task_search`   | Open items for a client, most important first, with computed priority |
| `task_get`      | One item with its log, history, revision and the priority's reason    |
| `client_list`   | Clients and their workstreams, with their ids                         |
| `task_add`      | A new item, taking the client's classification and boundary           |
| `task_update`   | Change fields at the revision read; history records what changed      |
| `task_claim`    | Hold an item so other agents leave it alone                           |
| `task_release`  | Give a claim up                                                       |
| `task_log`      | An append-only progress note                                          |
| `task_complete` | Done today, claim and blocked details cleared                         |

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

| Command                                                                                             | Does                                                        |
| --------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| `tasks clients`                                                                                     | Clients and their workstreams                               |
| `tasks search [--client ID] [--text …] [--unclaimed] [--claimed-by NAME] [--blocked] [--until DAY]` | Open items, most important first                            |
| `tasks show ID`                                                                                     | One item with its log                                       |
| `tasks claim ID` / `tasks release ID [--force]`                                                     | Hold an item, or give it up                                 |
| `tasks start ID [--note …]` / `tasks state ID STATE [--note …]`                                     | Set the state, with an optional note                        |
| `tasks done ID [--note …] [--on DAY]`                                                               | Mark it done                                                |
| `tasks move ID DAY`                                                                                 | Schedule it: `YYYY-MM-DD`, `today`, `tomorrow` or `backlog` |
| `tasks log ID [--status S] NOTE`                                                                    | Append a progress note                                      |
| `tasks add --client ID --title … [--day DAY] [--owner WHO] [--waiting-on WHO]`                      | Add an item                                                 |

Writes need `--by <session name>` or `TASKS_BY`. Add `--json` for the
server's answer. The address comes from `TASKS_MCP_URL` or the `env` block of
`~/.claude/settings.json`; the token from `TASKS_MCP_TOKEN` or the Keychain,
and it is never printed or put on a command line. Exit codes: 1 refused by
the server, 2 usage, 3 configuration (address or token), 4 server not
reachable.
