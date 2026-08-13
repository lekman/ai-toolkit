# calendar

Local Office 365 calendar connector. Reads a mailbox's calendars through
Microsoft Graph with delegated OAuth (device-code flow), and renders a day
view the [planner plugin](../../plugins/planner/README.md) consumes. Not
published to npm.

## Why OAuth Instead of Published ICS Feeds

Published ICS links are secret URLs that must be managed as credentials, they
strip or mangle event bodies, and recurrence expansion becomes the client's
problem. Graph fixes all three: `calendarView` expands recurrences
server-side, bodies arrive as plain text (`Prefer: body-content-type`), and
access is a revocable delegated grant (`Calendars.Read`, nothing else).

ICS remains the right tool for feeds without an OAuth story (e.g. iCloud);
the planner uses both side by side.

## Decisions

- **Live source, never indexed.** Calendar state changes constantly; an index
  is always stale for state. This package is a fetch, not a RAG source, and
  stays outside the MCP tool contract.
- **Events without attendees are todos.** The operating convention this
  supports: small self-events whose subject is the task. Events with
  attendees are meetings. A non-empty body is context, shown under the todo.
- **Admin calendars render as checklists.** Calendars marked `"kind": "admin"`
  (recurring administration, deadlines, invoicing) produce checkbox items,
  not timed meetings.
- **Display only.** The day view never writes anywhere. The task tracker
  (dashboard) remains the single source of truth; promoting a calendar todo
  into it is an explicit, separate action.

## Setup

One-time, in your tenant (requires `az login` with rights to create app
registrations):

```sh
./scripts/setup-entra.sh
```

Creates (or reuses) a public-client app named `ai-toolkit-calendar` with
delegated `Calendars.Read`, and writes tenant + client id to
`~/.claude/calendar.json`.

Then sign in:

```sh
bun src/auth.ts start    # prints a device code + URL; complete in browser
bun src/auth.ts finish   # exchanges the code, caches tokens
```

Tokens live in `~/.claude/calendar-token.json` (mode 0600) and refresh
themselves; you sign in again only if the refresh token is revoked or
expires from disuse.

## Configuration

`~/.claude/calendar.json` is private, mode 0600, and never committed:

```json
{
  "tenant": "<tenant-guid>",
  "clientId": "<app-client-id>",
  "timezone": "Europe/London",
  "cli": "/absolute/path/to/packages/calendar/src/day.ts",
  "calendars": [
    { "name": "Calendar", "kind": "meetings" },
    { "name": "Administration", "kind": "admin" }
  ]
}
```

- `kind: "meetings"`: events split into Meetings (has attendees) and Todos
  (no attendees, subject is the task).
- `kind: "admin"`: every event renders as a checklist item tagged with the
  calendar name.
- `cli`: where the planner skill finds the day-view entrypoint, so the
  public plugin never hardcodes a machine-specific path.

## Usage

```sh
bun src/auth.ts calendars       # list calendar names (verifies auth)
bun src/day.ts --date 2026-04-27
```

Day view output, in order: Meetings (times), Todos from calendar
(checkboxes, with first line of body as context when present), Admin
(checkboxes tagged by calendar). A missing calendar or failed auth prints a
loud INCOMPLETE warning rather than an empty-looking success.
