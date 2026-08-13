# Planner

A VS Code sidebar showing today's and tomorrow's tasks from the Obsidian
dashboard, filtered to the client that owns the repository you have open.

Read-only. The checkboxes show state; they do not change it. The dashboard is
edited in Obsidian or through the `obsidian` and `planner` Claude Code plugins.

## What it shows

Two panes in the Planner sidebar:

```ini
TODAY
  [ ] Task item, with **bold** and links rendered
  [x] A finished task
TOMORROW
  [ ] Tomorrow's task
```

Only today and tomorrow. Other days, the `Unscheduled` group, and the
`## Initiatives` index are all in the dashboard but never shown here — this
view answers "what is on now", not "what exists".

Each pane reads the `### <day>` heading that matches its date, then the
`#### **Client**` groups under it. Day headings carry no year, so the year is
inferred: of last year, this year and next, the extension takes the date
closest to today whose weekday matches the heading.

## Configuration

Normally none. The extension reads `~/.claude/obsidian.json` — the same file
the `obsidian` and `planner` Claude Code plugins use — for both the dashboard
location and the client filter:

- `vault` + `dashboard` give the path to `Dashboard.md`.
- `clients` maps repository paths to client names. Opening a repository listed
  there filters the view to that client, by longest prefix match. This is the
  rule `resolve-context.ts` uses, so the extension and the planner skills
  always agree on which client a repository belongs to.

Override either in settings when needed. Put `planner.clients` in the
repository's `.vscode/settings.json` to pin a repository to specific clients:

```json
{
  "planner.clients": ["Lekman Consulting"]
}
```

| Setting                      | Default  | Effect                   |
| ---------------------------- | -------- | ------------------------ |
| `planner.dashboardPath`      | `""`     | Path to `Dashboard.md`.  |
| `planner.clients`            | `[]`     | Client headings to show. |
| `planner.showClientHeadings` | `"auto"` | Print the client name.   |

An empty `planner.clients` derives the client from the path map; if that finds
nothing either, every client is shown. `showClientHeadings` takes `auto`,
which prints the name only when more than one client is visible, or `always`
or `never` to force it.

## Commands

- **Planner: Refresh** — re-read the dashboard.
- **Planner: Open Dashboard** — open `Dashboard.md` in the editor.

Both are on the view title bar. The panes also refresh when the file changes,
when a `planner.*` setting changes, and when the window regains focus — iCloud
writes the vault from another process and those writes do not always surface as
file-watcher events.

## Empty states

The three are deliberately distinct, because one blank pane for all of them
would hide a misconfiguration:

- **A message naming `obsidian.json` or `planner.dashboardPath`** — no
  dashboard could be located, or it could not be read. A setup problem.
- **"Nothing planned."** — the dashboard has no heading for that date.
- **"No tasks for `<client>`."** — the day exists, but the filter excluded
  everything under it.

## Build

```sh
bun install
bun run check     # typecheck, test, build
bun run package   # writes planner.vsix
```

Install the built file with
`code --install-extension packages/vscode-planner/planner.vsix`.

## Layout

Domains follow the repository's [clean architecture
rules](../../.claude/rules/clean-architecture.md): pure logic in
`{domain}/{name}.ts`, I/O behind a port interface in `{domain}.system.ts`.

| Path               | Holds                                              |
| ------------------ | -------------------------------------------------- |
| `src/config/`      | Resolving the dashboard path and the client filter |
| `src/dashboard/`   | Parsing `Dashboard.md`; inline markdown to HTML    |
| `src/view/`        | Building each pane's HTML; the webview providers   |
| `src/extension.ts` | Activation, the file watcher, commands             |

The webview runs with scripts disabled and a content security policy that
allows nothing but the inline stylesheet. Task text is HTML-escaped before any
tag is produced, and only `http`/`https` link targets become anchors.
