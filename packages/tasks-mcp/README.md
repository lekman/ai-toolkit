# tasks-mcp

The MCP server agents use to work with dashboard items, in place of editing
`Dashboard.md`. It reads and writes the Postgres database defined in
[dashboard-schema](../dashboard-schema), and every machine's sessions reach it
through the [tasks plugin](../../plugins/tasks).

| Path                                               | What it is                                                                |
| -------------------------------------------------- | ------------------------------------------------------------------------- |
| [src/tasks.ts](src/tasks.ts)                       | The operations: search, read, add, update, claim, complete                |
| [src/tools.ts](src/tools.ts)                       | The MCP tools over those operations, one registration for both transports |
| [src/http.ts](src/http.ts)                         | Streamable HTTP at `/mcp`, bearer token, `GET /health`                    |
| [src/bin/tasks-server.ts](src/bin/tasks-server.ts) | The HTTP server for the tailnet                                           |
| [src/bin/tasks-mcp.ts](src/bin/tasks-mcp.ts)       | The same tools over stdio, for one local session                          |
| [deploy/](deploy/)                                 | A launchd agent for the server                                            |

## Rules the Tools Keep

- **Every write names the agent** (`by`) and is recorded in the item's
  history: added, claimed, released, state, moved and edited.
- **Claims are exclusive.** Claiming is one statement, so two agents claiming
  at once cannot both win. An item claimed by one agent cannot be updated or
  completed by another without `force`.
- **Updates are revision checked.** A write names the revision it read and is
  refused when someone else wrote first, with a message telling the agent to
  read again.
- **Every write is validated** against the JSON Schema before it reaches the
  database, and the database's own constraints check again.
- **New items take their client's classification and boundary** and get a
  lower-case ULID as their id.
- **Search order is computed**: priority from business value against effort,
  then urgency from the due date, as in
  [priority.ts](../dashboard-schema/src/priority.ts). "Today" is the day in
  `TASKS_TIME_ZONE` (default Europe/London).

## Run It on the Mac Mini

The server runs on the machine with dashboard-db, connects to it on
127.0.0.1:5440, and binds to that machine's own Tailscale address on port 7450. It refuses a wildcard address, refuses to start without a Tailscale
address unless `--host` names one, and refuses a token under 32 characters.

1. Add a token to the database's env file, which already holds
   `DASHBOARD_DB_PASSWORD`:

   ```bash
   cd packages/dashboard-schema/deploy
   printf 'TASKS_MCP_TOKEN=%s\n' "$(openssl rand -hex 32)" >> .env
   ```

   Store the same token in the password manager; every machine's Keychain
   needs it.

2. Try it in the foreground:

   ```bash
   bun --env-file=packages/dashboard-schema/deploy/.env packages/tasks-mcp/src/bin/tasks-server.ts
   curl -s http://<tailnet address>:7450/health    # ok
   ```

3. Install [deploy/com.lekman.tasks-mcp.plist](deploy/com.lekman.tasks-mcp.plist)
   as a launchd agent, with the three paths filled in, so it starts at login
   and restarts if it stops.

Then, on each machine, put the token in the Keychain, set `TASKS_MCP_URL` and
install the plugin, as in [plugins/tasks](../../plugins/tasks/README.md).

## Test

```bash
bun test    # the operations and tools against PGlite, and the HTTP server with its token check
```
