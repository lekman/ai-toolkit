# atlas

Gives every Claude Code session the Atlas task MCP server, and a
[tasks](skills/tasks/SKILL.md) skill on how to use it. The server is
[packages/atlas-mcp](../../packages/atlas-mcp): it runs once, on the machine
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

The plugin reads two environment variables, so neither the address nor the
token is stored in this repository:

| Variable          | Value                                         |
| ----------------- | --------------------------------------------- |
| `ATLAS_MCP_URL`   | `http://<server's tailnet name>:7450/mcp`     |
| `ATLAS_MCP_TOKEN` | The server's token, from the password manager |

Set both where Claude Code inherits them, for example `~/.zshenv`, then:

```text
/plugin install atlas@ai-toolkit
```

Check with `claude mcp list`: `plugin:atlas:atlas` should show Connected. A
401 means the token is wrong; a connection error means the URL is wrong or the
machine is not on the tailnet.
