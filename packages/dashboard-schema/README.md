# dashboard-schema

The data model for dashboard work items, and the Postgres storage behind it.
It replaces the conventions the Obsidian dashboard encodes in markdown
(emoji for status, line order for priority, inline dated notes) with explicit
fields.

| Path                                                                   | What it is                                       |
| ---------------------------------------------------------------------- | ------------------------------------------------ |
| [schema/dashboard-item.schema.json](schema/dashboard-item.schema.json) | JSON Schema (2020-12) for one item               |
| [src/priority.ts](src/priority.ts)                                     | Priority, urgency and quadrant, computed on read |
| [src/db/schema.ts](src/db/schema.ts)                                   | Drizzle tables for Postgres                      |
| [migrations/](migrations/)                                             | Generated SQL, plus the append-only trigger      |
| [docs/database.md](docs/database.md)                                   | Tables, relationships and normalisation          |
| [deploy/compose.yaml](deploy/compose.yaml)                             | Postgres 17 for the Mac Mini                     |
| [examples/](examples/)                                                 | Valid items, including one imported from Atlas   |

## The Item

A superset of the Atlas `BacklogItem` (lekman/atlas,
`packages/core/src/model.ts`). Every Atlas field keeps its name and meaning, so
an Atlas item copies across unchanged: `id`, `classification`, `boundary`,
`clientId`, `workstreamId`, `requirementId`, `title`, `summary`, `state`,
`priority`, `tracker`, `effort`, `scheduledFor`, `blocked`, `doneOn`,
`detailsId`, `history`.

The additions:

- **`businessValue`**: `negative` (-1), `none`, `low`, `medium`, `high`,
  `veryHigh`. Atlas sizes value on a Fibonacci scale (1 to 13);
  `businessValueFromAtlas` maps it on import.
- **`due`**: a real external deadline. Urgency is computed from it.
- **`blockedOn`**: who or what a blocked item waits for, and since when.
- **`log`**: progress notes, each a time, a short status and a note of at most
  160 characters. Append only.
- **`claim`**: which agent has started the item. `claim.by` is the Atlas Agent
  id, so an agent's Atlas `workingOn` list is the items it claims, most recent
  claim first.
- **`rank`**, **`kind`**, **`tags`**, and a `dropped` state.
- **`revision`**: every write names the revision it read, and is refused when
  someone else wrote first. The Obsidian file has no such guard; the last
  writer wins.

Not stored: the computed priority, urgency and quadrant, and which band
(today, tomorrow, future) an item falls in. All are worked out on read.

## Priority Is Computed

Three inputs, `businessValue`, `effort` and `due`, give the priority:

1. **Value against effort**, from a lookup table: cheap valuable work first.
   Medium value at XS effort is high priority; low value or below is low
   priority at any effort.
2. **Urgency** from the due date: `now` when overdue or due within 2 working
   days, `soon` within 7 days. It raises priority one step, but only for
   medium value and above. Urgent low-value work stays low.
3. **Covey's quadrant** (First Things First): important means medium value or
   above. Q2, important but not urgent, is the work to schedule deliberately.

Until both `businessValue` and `effort` are set, the stored `priority` (as
imported, or set by hand) is used, exactly as Atlas does. `assess()` returns
the priority with a one-line reason.

## Storage

Postgres, through Drizzle. The JSON Schema's cross-field rules are also check
constraints, so a writer that skips validation still cannot store a broken
item. `item_log` and `item_history` refuse UPDATE and DELETE through a
trigger; deleting the item removes them with it. An item's workstream must
belong to the item's own client, through a composite foreign key. See
[docs/database.md](docs/database.md) for the diagram and the reasoning.

```bash
bun test                      # schema, priority, and the database through PGlite
bunx drizzle-kit generate     # after changing src/db/schema.ts
DATABASE_URL=postgres://... bun src/db/migrate.ts
```

Read a generated migration before committing it. drizzle-kit can emit a
foreign key before the unique constraint that the key references, which
Postgres refuses; `0002_workstream_same_client.sql` had its two statements
swapped by hand for that reason.

### Deploy on the Mac Mini

```bash
cd packages/dashboard-schema/deploy
cp .env.example .env && chmod 600 .env    # set DASHBOARD_DB_PASSWORD
docker compose up -d
DATABASE_URL="postgres://dashboard:<password>@127.0.0.1:5440/dashboard" bun ../src/db/migrate.ts
tailscale serve --bg --tcp 5440 tcp://127.0.0.1:5440   # reach it from the tailnet
```

Port 5440 binds to localhost only; Tailscale Serve carries it to the tailnet.
Atlas uses 7400, 7401 and 7432, and Serve ports 443, 8443 and 10000.
