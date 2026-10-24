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
