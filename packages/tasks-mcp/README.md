# tasks-mcp

The MCP server agents use to work with dashboard items, in place of editing
`Dashboard.md`. It reads and writes the Postgres database defined in
[dashboard-schema](../dashboard-schema), and every machine's sessions reach it
through the [tasks plugin](../../plugins/tasks).

| Path                                               | What it is                                                                |
| -------------------------------------------------- | ------------------------------------------------------------------------- |
| [src/tasks.ts](src/tasks.ts)                       | The operations: search, read, add, update, claim, complete                |
| [src/hoststats.ts](src/hoststats.ts)               | Host statistics: store and list samples, breach limits, retention         |
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
  completed by another without `force`. An update that changes only the
  business value, effort or due date goes through, because those grade the
  item rather than work on it.
- **Updates are revision checked.** A write names the revision it read and is
  refused when someone else wrote first, with a message telling the agent to
  read again.
- **Every write is validated** against the JSON Schema before it reaches the
  database, and the database's own constraints check again.
- **New items take their client's classification and boundary** and get a
  lower-case ULID as their id.
- **Open means not done or dropped.** A search with no `states` returns
  `todo`, `doing`, `review`, `approved` and `merged`. `pullRequest` finds the
  items that link one PR, without regard to case; gh-events uses it to move
  items as their PRs are approved, merged and released.
- **Search order is computed**: priority from business value against effort,
  then urgency from the due date, as in
  [priority.ts](../dashboard-schema/src/priority.ts). "Today" is the day in
  `TASKS_TIME_ZONE` (default Europe/London).

## Host Statistics

Two tools carry load numbers for the machines, so Atlas can show them:

| Tool             | Does                                                                                   |
| ---------------- | -------------------------------------------------------------------------------------- |
| `host_stat_push` | Store one sample: CPU, load, memory free, swap, disk free and runners. A retry is safe |
| `host_stat_list` | Each host's newest numbers, last seen, the limits it is past, and samples in a range   |

- **A host is named within its client.** A token scoped to one client that
  pushes host `server` writes that client's `server` and cannot touch
  another client's. `host_stat_list` shows a scoped token only its clients'
  hosts.
- **Samples are UTC, every 5 minutes.** A push more than 5 minutes ahead of
  the server's clock, or more than 7 days old, is refused. A second push for
  the same host and time returns `stored: false`.
- **Retention runs in the database.** `host_stat_rollup()` averages 5-minute
  samples older than 7 days into hourly rows, and deletes hourly rows older
  than 97 days. `tasks-server` calls it at start-up and then every hour; a
  failure is logged and the server keeps running. Nothing else schedules it.
- **Breaches** are worked out on read, from `LIMITS` and `ALWAYS_ON` in
  [src/hoststats.ts](src/hoststats.ts):

  | Metric       | Warn                 | Crit                 | Judged on                       |
  | ------------ | -------------------- | -------------------- | ------------------------------- |
  | `memFreePct` | below 20             | below 10             | the newest sample               |
  | `swapUsedMb` | above 8192           | above 24576          | the newest sample               |
  | `diskFreeGb` | below 50             | below 20             | the newest sample               |
  | `cpuPct`     | 90 or more           |                      | the mean of the last 15 minutes |
  | `lastSeen`   | more than 17 minutes | more than 60 minutes | always-on hosts only (`server`) |

  The `lastSeen` warning waits for three missed samples plus 2 minutes'
  grace, because the laptop sleeps and the server can be a minute late. The
  crit values must match the watchdog's (`~/homelab/watchdog/watchdog.sh`);
  tell Commander when they change.

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

## Tokens Limited to Some Clients

The main token (`TASKS_MCP_TOKEN`) reads and writes every client. A machine
that must see only some clients, such as a laptop a client controls, gets a
scoped token instead. With it, client_list, search and every write are
limited to the named clients, and an item outside them behaves as if it did
not exist.

The server holds only each token's SHA-256, in a JSON file named by
`TASKS_MCP_SCOPED_TOKENS` (add the line to the deploy `.env`):

```json
[
  {
    "name": "acme-laptop",
    "sha256": "<64 hex characters>",
    "clients": ["acme"]
  }
]
```

To issue one on the server, without the token passing through a file or the
screen:

```bash
TOKEN=$(openssl rand -hex 32)
HASH=$(printf %s "$TOKEN" | shasum -a 256 | cut -d' ' -f1)
# add {"name": …, "sha256": "$HASH", "clients": […]} to the scoped tokens file
# store $TOKEN in the password manager, then: unset TOKEN
```

Restart the server after changing the file; it lists the scoped tokens' names
when it starts. To revoke one, remove its entry and restart.

## Test

```bash
bun test    # the operations and tools against PGlite, and the HTTP server with its token check
```
