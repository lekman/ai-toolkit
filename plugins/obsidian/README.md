# Obsidian

The dashboard keeps only today expanded: today's section sits unprefixed under
`## Focus`, while future days live inside a collapsed `> [!note]- Future`
callout (every line `"> "`-prefixed) and the Initiatives body inside
`> [!note]- All clients`. Skills that keep an Obsidian `Dashboard.md` in sync
from Claude Code: add, tick,
and list tasks, reconcile a repo's `.tmp/TODO.md`, and load the note you are
working on. The active client is resolved by **discovery** (from your working
directory), so no client name is ever written into a skill.

Invoke as `/obsidian:dashboard`, `/obsidian:add`, `/obsidian:tick`,
`/obsidian:today`, `/obsidian:wrapup`, `/obsidian:sync-todo`, `/obsidian:focus`.

## Privacy Model: Three Tiers, Only One Is Shareable

This plugin is built so that client identities never leave your machine:

1. **Logic (these skills)**: generic. They read a config file and resolve the
   active client at runtime. Safe to share; this is what lives here.
2. **Config (`~/.claude/obsidian.json`)**: your private map of repository path to
   client name, plus the vault location and Jira host. This is the discovery
   source. **Never commit it.** It is not part of this plugin.
3. **Vault (your Obsidian notes)**: the actual dashboard and client data. Reached
   through the filesystem, never through git.

The skills only ever name a client that they read from tier 2 at runtime. Grep
this folder and you will find placeholders (`Acme`), never a real client.

## Setup

Copy the example config and fill it in on the machine that has the vault:

```bash
cp plugins/obsidian/obsidian.example.json ~/.claude/obsidian.json
# then edit ~/.claude/obsidian.json
```

```json
{
  "vault": "/path/to/your/Obsidian/Vault",
  "dashboard": "Dashboard.md",
  "jira_host": "your-org.atlassian.net",
  "clients": {
    "/Users/you/Repo/acme": "Acme",
    "/Users/you/Repo/globex": "Globex"
  },
  "default_client": "Acme",
  "regulatory": {
    "Acme": ["GxP"],
    "Globex": ["GxP"]
  }
}
```

`clients` maps a repository path prefix to a client label. The active client is
the **longest** prefix of your current directory, falling back to
`default_client`. That is the whole of "discovery": no name is hardcoded in a
skill, it is looked up from where you are working.

`regulatory` records which standards govern each client's work. It is the same
discovery idea applied to compliance: the standard is a property of the client,
recorded once here, so no repository has to state which regime it falls under.
A client with no entry is unregulated. `/git:pr` reads it to decide whether the
default pull request template's **Regulatory impact** section applies, and
deletes that section outright when the list is empty: an unregulated repo
carrying an unanswered risk question reads as an unfinished PR, not as
diligence.

## Using It on an Isolated Agent

If you run an isolated per-client agent (for example a dedicated macOS user on a
separate machine), sharing these skills through git gives the agent the _logic_.
It still needs two things, and **neither goes through git**:

- **A client-scoped config.** Give that agent an `~/.claude/obsidian.json` whose
  `clients` map contains **only its one client**, provisioned locally on that
  machine. Least privilege: the agent cannot name a client it was never told
  about, so even a full config dump reveals nothing about your other clients.
- **A scoped vault.** The skills read and write files under `vault`. An isolated
  account does not see your primary vault, and your master `Dashboard.md` lists
  every client's tasks. Point that agent at a **per-client** dashboard and vault
  subset, synced back to your master through a private channel (a sync tool, a
  private remote you control), not through this repository.

The rule of thumb: the skill is generic and public; the config is one client and
private; the vault is data and never in git.

### In a Container

[`claude-docker`](../../packages/claude-docker/README.md) does the client-scoped
half automatically. Point it at your vault once, using the path already in your
config so the two cannot drift:

```bash
ln -s "$(jq -r .vault ~/.claude/obsidian.json)" ~/.claude/docker/vault
```

The vault is then mounted at `~/vault` inside the container, **read-only** unless
you pass `--vault-write`, and the `obsidian` and `planner` plugins are enabled
for that run. `claude-docker --status` shows both.

Your own `~/.claude/obsidian.json` is never mounted. A reduced one is generated
per run under `~/.claude/docker/generated/`, holding only the client resolved
from the directory you launched from, keyed on the container's single checkout at
`/work`:

```json
{
  "vault": "/home/claude/vault",
  "dashboard": "Dashboard.md",
  "clients": { "/work": "Acme" },
  "default_client": "Acme",
  "planner": {
    "Acme": { "plans": "Clients/Acme/Initiatives", "tracker": "github" }
  }
}
```

That is the same least-privilege rule as above, applied without you maintaining a
second config: every other client's name, repo path, and tracker settings stay on
the host.

The vault mount is still the whole vault. Read-only stops the agent changing
notes, not reading them. See the boundary notes in the
[claude-docker README](../../packages/claude-docker/README.md).

## Skills

- **dashboard**: open `Dashboard.md` and report the active client.
- **add**: append `- [ ] <client>: <text>` under today's heading.
- **tick**: mark a task done by substring match, scoped to the active client.
- **today**: list today's open tasks, filtered to the active client.
- **wrapup**: end-of-session multi-select tick across all clients.
- **sync-todo**: reconcile a repo's `.tmp/TODO.md` into the dashboard.
- **focus**: load the most recently edited vault note as working context.
