# Planner

A VS Code sidebar showing today's and tomorrow's tasks from the Obsidian
dashboard, filtered to the client that owns the repository you have open.

Read-only. The checkboxes show state; they do not change it. The dashboard is
edited in Obsidian or through the `obsidian` and `planner` Claude Code plugins.

## What It Shows

Two panes in the Planner sidebar:

```ini
TODAY
  [ ] Task item, with **bold** and links rendered
  [x] A finished task
TOMORROW
  [ ] Tomorrow's task
```

Only today and tomorrow. Other days, the `Unscheduled` group, and the
`## Initiatives` index are all in the dashboard but never shown here: this
view answers "what is on now", not "what exists".

Each pane reads the `### <day>` heading that matches its date, then the
`#### **Client**` groups under it. Day headings carry no year, so the year is
inferred: of last year, this year and next, the extension takes the date
closest to today whose weekday matches the heading.

## Configuration

Normally none. The extension reads `~/.claude/obsidian.json`, the same file
the `obsidian` and `planner` Claude Code plugins use, for both the dashboard
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
  "planner.clients": ["Acme"]
}
```

| Setting                      | Default  | Effect                     |
| ---------------------------- | -------- | -------------------------- |
| `planner.dashboardPath`      | `""`     | Path to `Dashboard.md`.    |
| `planner.clients`            | `[]`     | Client headings to show.   |
| `planner.showClientHeadings` | `"auto"` | Print the client name.     |
| `planner.showCompleted`      | `true`   | Show `- [x]` tasks.        |
| `planner.pollSeconds`        | `30`     | Fallback re-read interval. |
| `planner.vaultRoot`          | `""`     | Vault path, for links.     |

An empty `planner.clients` derives the client from the path map; if that finds
nothing either, every client is shown. `showClientHeadings` takes `auto`,
which prints the name only when more than one client is visible, or `always`
or `never` to force it.

## Commands

All four sit on the view title bar.

- **Hide / Show Completed Tasks**: the eye button. Drops `- [x]` tasks from
  both panes, and drops a client group left with nothing. Writes
  `planner.showCompleted` in your user settings, so it is remembered and
  applies to every repository.
- **Planner: Refresh** re-reads the dashboard now.
- **Planner: Open Dashboard** opens `Dashboard.md` in the editor.

## Staying Current

Four triggers, because no single one is reliable on a synced vault:

1. **A file watcher** on the dashboard, scoped to its own directory since the
   vault sits outside the workspace.
2. **Polling** every `planner.pollSeconds`, which compares the file's
   modification time and only re-parses when it moves. iCloud and other sync
   clients write the vault from another process, and those writes do not
   reliably raise a watcher event; this is what covers that gap. Set it to
   `0` to switch polling off.
3. **Window focus**, which also picks up a date rollover across an overnight
   session, so "today" does not stay on yesterday.
4. **Any `planner.*` setting change.**

## Empty States

They are deliberately distinct, because one blank pane for all of them would
hide a misconfiguration:

- **A message naming `obsidian.json` or `planner.dashboardPath`**: no
  dashboard could be located, or it could not be read. A setup problem.
- **"Nothing planned."**: the dashboard has no heading for that date.
- **"No tasks for `<client>`."**: the day exists, but the filter excluded
  everything under it.
- **"No open tasks for `<client>`."**: the same, with completed tasks
  hidden. Worth distinguishing: a day full of finished work would otherwise
  read as a day nothing was planned for.

## Install

Not published to the Visual Studio Marketplace, and not intended to be. It
reads a personal Obsidian vault and is built to be installed from the file you
produce yourself.

Build the `.vsix`, then install it:

```sh
cd packages/vscode-planner
bun install
bun run package                              # writes planner.vsix
code --install-extension planner.vsix
```

Reload the window afterwards (**Developer: Reload Window**), then open the
Planner icon in the activity bar.

For VS Code forks, swap the CLI: `cursor`, `windsurf`, or
`codium --install-extension planner.vsix`. If no CLI is on your `PATH`, use
**Extensions: Install from VSIX…** in the command palette and pick the file.

To upgrade, rebuild and install again; the same command overwrites the
installed copy. Bump `version` in `package.json` first if you want VS Code to
show the change. To remove it: `code --uninstall-extension lekman.planner`.

Because it is installed from a file rather than the marketplace, VS Code will
never update it for you. It also does not sync through Settings Sync, so each
machine needs its own install.

## Develop

```sh
bun run check     # typecheck, test, build
```

Press `F5` in this folder to launch an Extension Development Host with the
extension loaded, which is faster than rebuilding the `.vsix` on each change.

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
