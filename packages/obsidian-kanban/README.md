# Dashboard Kanban

Obsidian plugin. Renders `Dashboard.md` as a board: one row per client, four
columns in this order — Today, Tomorrow, Future, Unscheduled.

Desktop only. It reads and writes a local file and spawns the planner scripts,
none of which the mobile app can do.

## Install

```bash
bun run install-plugin
```

Copies `main.js`, `manifest.json`, `styles.css` and `README.md` into
`<vault>/.obsidian/plugins/dashboard-kanban/` and adds the plugin to
`community-plugins.json`. The vault comes from `~/.claude/obsidian.json`, the
same file the planner scripts read; pass `--vault <path>` to override it and
`--dry-run` to see what it would do.

Then reload Obsidian ("Reload app without saving", Cmd+P on macOS).

Settings are not copied. `data.json` holds the view, collapsed rows and paths,
which are per-machine and stay out of git.

For the Archive and Roll buttons the machine also needs `bun`, and this repo
cloned — `~/Repo/ai-toolkit` by default, changeable in the plugin's settings.

## What it reads

The three bands under `## Focus`, as defined in
`plugins/obsidian/rules/dashboard-structure.md`:

- Today is the unprefixed `### <day>` section.
- Tomorrow is the single day inside `> [!note]- Tomorrow`.
- Future is every day inside `> [!note]- Future`; the day whose heading
  contains "Unscheduled" becomes its own column.

Client rows come from `#### **Client**` headings. Items with no client heading
above them appear in a "No client" row. Bold-only paragraphs above a run of
items are shown as run headers, so the priority grouping survives.

## View

The toolbar has a **View** picker, which chooses the columns:

| View            | Columns                              |
| --------------- | ------------------------------------ |
| Focus           | Today, Tomorrow                      |
| Today (default) | Today                                |
| All             | Today, Tomorrow, Future, Unscheduled |

The choice is saved, so the board opens in the same view next time. Client rows
and the open count follow the view: a client whose only items are Unscheduled
gets no row in Focus. The right-click "Move to ..." entries still list all four
columns, so a card can be pushed out of the current view.

Done items are hidden by default. "Show done" in the toolbar brings them back.

## Client rows

Clicking a client name on the left collapses that row, and clicking again
expands it. A collapsed row keeps its cells and shows the number of cards in
each, so a card can still be dropped into it. Which clients are collapsed is
saved with the settings.

Right-clicking a card offers **Move to client**, listing every client in the
file plus any set in Client order. Moving to a client with no group in that day
creates the `#### **Client**` heading. Obsidian 1.5 and later shows this as a
submenu; older versions get flat `Move to <client>` entries.

## Archive and Roll

Two toolbar buttons, which do **not** write the dashboard themselves. They run
the ai-toolkit scripts:

| Button  | Runs                                                   | What it does                                                                                                                                                                                |
| ------- | ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Roll    | `roll-forward.ts`                                      | Moves today's open items into Tomorrow, dropping the `🔄` claim marker. Then, only when today's section is empty, promotes Tomorrow to today and the earliest dated Future day to Tomorrow. |
| Archive | `archive-done.ts`, then `roll-forward.ts --shift-only` | Moves ticked items into `Archive/Work Logs/<year>/<Month>.md`, drops emptied client groups and the day heading, then turns the page.                                                        |

Archive turns the page itself because clearing the day without promoting the
next one leaves the file with no unprefixed day heading, which reads as a
broken dashboard. Its second step is `--shift-only`, so it never moves another
client's still-open work.

So the order does not matter: Roll then Archive, or Archive alone, both end
with the next day in focus.

Those scripts own the write protocol, including the iCloud conflict-copy guard
this plugin does not have. Repeating their logic here would give one dashboard
two writers that drift, so the buttons shell out instead.

Both run `--dry-run --verbose` first and show what would move. Nothing is
written until that is confirmed.

Settings: **ai-toolkit folder** (default `~/Repo/ai-toolkit`) and **bun path**
(default: searched under mise, `~/.bun` and Homebrew, because Obsidian does not
inherit a login shell's PATH).

## What it writes

Ticking a checkbox, and dragging a card to another column or client row.
Every write:

1. re-reads the file and aborts if the source line changed since the board was
   drawn (several agents write this file);
2. copies the file to `~/.claude/dashboard-snapshots/` first;
3. inserts after the last open item of the target group, so ticked items stay
   at the bottom of their run.

Dragging into a column where the client has no group creates the
`#### **Client**` heading at the end of that day.

## Development

No build step — `main.js` is plain CommonJS. Edit it, then run
"Reload app without saving" in Obsidian (Ctrl+P) to pick up changes.

```bash
bun test
```

`tests/load.ts` loads `main.js` outside Obsidian: it stubs the `obsidian`
module the host injects, rewrites `module.exports` to expose the internals, and
writes the result as `.cjs` so it stays CommonJS inside this ESM package. A new
export destructured at the top of `main.js` has to be added to `EXPORTS` and to
the stub, or every test fails at load with "Class extends value undefined".

Tests run against the fixture in `tests/load.ts`, never against a real vault,
and use placeholder client names because this repo is public.

`require("child_process")` is stubbed too, and the default stub **refuses to
spawn**. `runScript` resolves it lazily at click time rather than at load time,
so a hook installed only while `main.js` is being required is already gone when
a test calls it — and the test then runs the real scripts against the real
vault. That happened once and rolled a live dashboard a day forward. A test
that wants a spawn passes its own stub.

These live in `/tmp` and do not survive a reboot.
