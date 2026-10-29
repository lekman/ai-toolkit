# Atlas

A VS Code sidebar showing your work dashboard, opened on the client that owns
the repository you have open.

The sidebar shows one of two things:

- **The Atlas page**, when it can be read. This is the same HTML page the
  [live dashboard](../../practices/live-dashboard/README.md) Claude artifact
  is published from, so the sidebar matches the artifact: next meeting,
  worklist with Today, Tomorrow and Backlog, item menus, details, and the
  tracker and release tabs.
- **Today and Tomorrow panes** otherwise, read from the Obsidian
  `Dashboard.md`, as described under [Today and Tomorrow](#today-and-tomorrow).

## The Atlas Page

The page talks to its runtime through `window.claude.use("mcp")` and
`window.claude.use("db")`. In VS Code a small script stands in for that
runtime and passes each call to the extension:

| The page asks for                       | VS Code answers from                                                   |
| --------------------------------------- | ---------------------------------------------------------------------- |
| `host:dashboard` tools                  | The local dashboard server, started from the Claude desktop config     |
| The data store (`db`)                   | A JSON file in the extension's storage, on this machine only           |
| `GitHub`, `Microsoft 365`, `monday.com` | The services' own APIs, see [Direct Connectors](#direct-connectors)    |
| Any other connector                     | `not_granted`, so that section stays empty, as outside the desktop app |

The page keeps its choices in `localStorage`: the client, the tab, the band,
the folds and show done. A webview's own storage does not reliably survive a
reload, so the extension keeps them instead. The client is kept per
workspace, starting on the repository's own client until you choose another;
the rest apply in every window. The page also gets the base style the
artifact host adds, so what it hides, such as another client's tabs, stays
hidden.

The page is read from the vault on each change and never bundled, so the
extension holds no client names and a republished page needs no rebuild.
Each VS Code window starts its own copy of the dashboard server.

The webview allows scripts carrying a per-render nonce, Google Fonts, and the
Markdown libraries the page loads from cdnjs. The page makes no other network
requests; everything else goes through the extension, which checks each
message and only accepts store paths shaped like the ones the page writes.

## Direct Connectors

VS Code cannot reach claude.ai connectors, so the extension calls the APIs
behind the three the page uses and answers in the connector's shape. Each
uses a credential that already lives on the machine, or one kept in the
Keychain:

| Connector     | API                                       | Credential                                                           |
| ------------- | ----------------------------------------- | -------------------------------------------------------------------- |
| GitHub        | REST: issue search and the signed-in user | The account `gh` is signed in to (`gh auth token`)                   |
| Microsoft 365 | Graph: the default calendar's view        | The [calendar package](../calendar)'s sign-in, `Calendars.Read` only |
| monday.com    | GraphQL: one board's items                | A personal API token, set with **Atlas: Set monday.com Token**       |

The monday.com token is stored in VS Code SecretStorage, which is the macOS
Keychain, never in the settings: settings are plain text and Settings Sync
copies them. **Atlas: Clear monday.com Token** removes it. A personal token
carries everything your monday.com user may do, writes included, although
the extension only reads.

`planner.connectors` lists the ones in use; remove one to leave its section
empty. A connector with no credential answers `not_granted`, and a refused
one `needs_reauth`, which the page shows as it does in the artifact. Google
Calendar has no direct version: calendars shared as `.ics` feeds already
reach the page through the dashboard server.

## Today and Tomorrow

Two panes, shown when the Atlas page cannot be read:

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

| Setting                      | Default       | Effect                                         |
| ---------------------------- | ------------- | ---------------------------------------------- |
| `planner.atlasPage`          | `""`          | Path to the Atlas page.                        |
| `planner.atlasServer`        | `"dashboard"` | The dashboard server's key in Claude's config. |
| `planner.dashboardPath`      | `""`          | Path to `Dashboard.md`.                        |
| `planner.connectors`         | all three     | Direct connectors in use.                      |
| `planner.clients`            | `[]`          | Client headings to show.                       |
| `planner.showClientHeadings` | `"auto"`      | Print the client name.                         |
| `planner.showCompleted`      | `true`        | Show `- [x]` tasks.                            |
| `planner.pollSeconds`        | `30`          | Fallback re-read interval.                     |
| `planner.vaultRoot`          | `""`          | Vault path, for links.                         |

An empty `planner.atlasPage` uses `_Dashboard Sync/dashboard-page.html` in
the vault. The dashboard server is the `mcpServers` entry the Claude desktop
app starts for the artifact, read from
`~/Library/Application Support/Claude/claude_desktop_config.json`. With one
client resolved for the repository, the Atlas page opens on it; the client
pill on the page still changes it.

An empty `planner.clients` derives the client from the path map; if that finds
nothing either, every client is shown. `showClientHeadings` takes `auto`,
which prints the name only when more than one client is visible, or `always`
or `never` to force it.

## Commands

All of them sit on the view title bar. Over the Atlas page it shows Toggle
Hidden Files, Refresh and Open Dashboard; the page has its own show-done
checkbox.

- **Hide / Show Completed Tasks**: the eye button. Drops `- [x]` tasks from
  both panes, and drops a client group left with nothing. Writes
  `planner.showCompleted` in your user settings, so it is remembered and
  applies to every repository.
- **Atlas: Toggle Hidden Files**: the files button. Shows or hides what
  your user `files.exclude` hides. Showing sets each `true` pattern to
  `false` and remembers which ones they were; hiding sets exactly those back.
  The list stays in your user settings, so other extensions that read it
  follow along.
- **Atlas: Refresh** re-reads the dashboard and reloads the Atlas page.
- **Atlas: Open Dashboard** opens `Dashboard.md` in the editor.

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
Atlas icon in the activity bar.

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
| `src/atlas/`       | Hosting the Atlas page and answering its runtime   |
| `src/connectors/`  | Connector calls answered by the services' APIs     |
| `src/config/`      | Resolving the dashboard path and the client filter |
| `src/dashboard/`   | Parsing `Dashboard.md`; inline markdown to HTML    |
| `src/view/`        | Building each pane's HTML; the webview providers   |
| `src/extension.ts` | Activation, the file watcher, commands             |

The Today and Tomorrow webviews run one nonce'd script and a content security
policy that allows nothing else. Task text is HTML-escaped before any
tag is produced, and only `http`/`https` link targets become anchors.
